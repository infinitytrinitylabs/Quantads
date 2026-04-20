import { IncomingMessage, ServerResponse } from "node:http";
import { verify, JwtPayload } from "jsonwebtoken";
import { logger } from "../lib/logger";

export interface QuantmailToken {
  sub: string;     // opaque user ID
  iss: string;     // must be "quantmail"
  iat: number;
  exp: number;
  scope?: string;
}

const QUANTMAIL_ISSUER = "quantmail";
const JWT_SECRET = (() => {
  const secret = process.env["QUANTMAIL_JWT_SECRET"];
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("QUANTMAIL_JWT_SECRET must be set in production environment");
    }
    return "dev-secret-change-in-production";
  }
  return secret;
})();

/** Extracts and verifies the Quantmail Bearer JWT from the Authorization header.
 *  Returns the decoded token payload or throws on failure. */
export function verifyQuantmailToken(authorizationHeader: string | undefined): QuantmailToken {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    throw new Error("Missing or malformed Authorization header");
  }

  const token = authorizationHeader.slice(7);

  try {
    const decoded = verify(token, JWT_SECRET, {
      issuer: QUANTMAIL_ISSUER,
      algorithms: ["HS256"]
    }) as JwtPayload & QuantmailToken;

    if (!decoded.sub) {
      throw new Error("Token is missing required 'sub' claim");
    }

    return decoded as QuantmailToken;
  } catch (err) {
    const message = err instanceof Error ? err.message : "JWT verification failed";
    throw new Error(`Unauthorized: ${message}`);
  }
}

/** Higher-order helper: wraps a route handler and injects the verified user token.
 *  Sends a 401 response automatically if authentication fails. */
export function withAuth(
  handler: (req: IncomingMessage, res: ServerResponse, token: QuantmailToken) => Promise<void>
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const token = verifyQuantmailToken(req.headers.authorization);
      logger.debug({ userId: token.sub }, "auth ok");
      await handler(req, res, token);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unauthorized";
      logger.warn({ err: message }, "auth failure");
      res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: message }));
    }
  };
}
