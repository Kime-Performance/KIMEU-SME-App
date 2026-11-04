import { X509Certificate } from "node:crypto";

/** Build connection settings without ever including credentials in errors. */
export function truthDatabaseConnectionOptions(rawUrl: string, rawCa?: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("KIMEU_TRUTH_DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("KIMEU_TRUTH_DATABASE_URL must use the PostgreSQL protocol.");
  }
  // Discard legacy URL modes: certificate verification is configured
  // explicitly below rather than delegated to a connection-string option.
  url.searchParams.delete("sslmode");
  const ca = rawCa?.replace(/\\n/g, "\n").trim();
  if (ca) {
    try {
      const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
      if (!certificates?.length || ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, "").trim()) {
        throw new Error("Invalid PEM");
      }
      if (certificates.some(pem => !new X509Certificate(pem).ca)) {
        throw new Error("Not a CA certificate");
      }
    } catch {
      throw new Error("KIMEU_TRUTH_DATABASE_CA_CERT must contain public PEM CA certificates only, not a private key.");
    }
  }
  return {
    connectionString: url.toString(),
    options: {
      prepare: false as const,
      max: 1,
      connect_timeout: 10,
      ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    },
  };
}
