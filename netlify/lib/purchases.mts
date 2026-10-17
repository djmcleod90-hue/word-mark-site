// In-app purchases of Close Reads: checks Apple's signature on the purchase before crediting it.

import { Environment, SignedDataVerifier, type JWSTransactionDecodedPayload } from "@apple/app-store-server-library";
import { APPLE_ROOT_CA_G3 } from "./apple-roots.mts";

const BUNDLE_ID = "ca.word-mark.WordMark";

/** What each scan product adds. The price is set in App Store Connect. */
export const SCAN_PRODUCTS: Record<string, number> = { "ca.word_mark.WordMark.scans15": 15 };

export interface VerifiedPurchase { transactionId: string; productId: string; environment: string }

/** The environment a purchase claims, read before checking its signature, to pick the right verifier. */
function claimedEnvironment(jws: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(jws.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.environment === "string" ? payload.environment : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a StoreKit 2 signed transaction (JWS) from the app. Production purchases need APP_APPLE_ID (from
 * App Store Connect). Xcode's local test purchases aren't signed by Apple, so they're refused unless
 * ALLOW_XCODE_PURCHASES is "true" — only ever for testing.
 */
export async function verifyPurchase(jws: string, env = process.env): Promise<VerifiedPurchase | null> {
  const claimed = claimedEnvironment(jws);
  let environment: Environment;
  if (claimed === Environment.PRODUCTION) environment = Environment.PRODUCTION;
  else if (claimed === Environment.SANDBOX) environment = Environment.SANDBOX;
  else if (claimed === Environment.XCODE && env.ALLOW_XCODE_PURCHASES === "true") environment = Environment.XCODE;
  else return null;

  const appAppleId = env.APP_APPLE_ID ? Number(env.APP_APPLE_ID) : undefined;
  if (environment === Environment.PRODUCTION && !appAppleId) return null;
  try {
    const verifier = new SignedDataVerifier([APPLE_ROOT_CA_G3], true, environment, BUNDLE_ID, appAppleId);
    const transaction: JWSTransactionDecodedPayload = await verifier.verifyAndDecodeTransaction(jws);
    if (!transaction.transactionId || !transaction.productId || transaction.revocationDate) return null;
    return { transactionId: transaction.transactionId, productId: transaction.productId, environment };
  } catch {
    return null;
  }
}
