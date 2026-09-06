import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";

interface LearnCertificatePDFProps {
  companyName: string;
  learnerName: string;
  trackTitle: string;
  issuedAt: string;
  expiresAt: string;
  verificationCode: string;
  verifyUrl: string;
  /** Resolved data URL — never a promise. */
  qrDataUrl: string;
  contentVersion: string;
  examScorePercent: string;
  challengeCount: number;
  status: "Active" | "Expired" | "Revoked";
}

const tw = createTw({
  theme: {
    fontFamily: { sans: ["Helvetica", "Arial", "sans-serif"] },
    extend: {
      colors: { gray: { 400: "#9a9a9a", 500: "#7d7d7d", 700: "#3f3f3f" } }
    }
  }
});

const formatDay = (iso: string) => iso.slice(0, 10);

/**
 * The certificate itself. Landscape A4, Helvetica (a PDF built-in, so no font
 * registration is needed), and a QR that resolves to the public verification
 * page — the thing that makes this more than a picture of an achievement.
 */
const LearnCertificatePDF = ({
  companyName,
  learnerName,
  trackTitle,
  issuedAt,
  expiresAt,
  verificationCode,
  verifyUrl,
  qrDataUrl,
  contentVersion,
  examScorePercent,
  challengeCount,
  status
}: LearnCertificatePDFProps) => (
  <Document title={`${trackTitle} — ${learnerName}`}>
    <Page size="A4" orientation="landscape" style={tw("p-0 bg-white")}>
      <View style={tw("flex-1 m-8 border border-gray-400 p-10 flex flex-col")}>
        <View style={tw("flex flex-row justify-between items-start")}>
          <View>
            <Text
              style={{ ...tw("text-gray-500"), fontSize: 10, letterSpacing: 2 }}
            >
              CERTIFICATE OF COMPLETION
            </Text>
            <Text style={{ ...tw("text-gray-700 mt-1"), fontSize: 12 }}>
              {companyName}
            </Text>
          </View>
          {status !== "Active" && (
            <Text
              style={{
                ...tw("text-gray-500 border border-gray-400 px-2 py-1"),
                fontSize: 10,
                letterSpacing: 1
              }}
            >
              {status.toUpperCase()}
            </Text>
          )}
        </View>

        <View style={tw("mt-10")}>
          <Text style={{ ...tw("text-gray-500"), fontSize: 11 }}>
            This certifies that
          </Text>
          <Text style={{ fontSize: 30, fontWeight: "bold", marginTop: 6 }}>
            {learnerName}
          </Text>
          <Text style={{ ...tw("text-gray-500 mt-6"), fontSize: 11 }}>
            has completed the Carbon learning track
          </Text>
          <Text style={{ fontSize: 20, fontWeight: "bold", marginTop: 6 }}>
            {trackTitle}
          </Text>
        </View>

        <View style={tw("mt-8")}>
          <Text
            style={{ ...tw("text-gray-700"), fontSize: 10, lineHeight: 1.5 }}
          >
            Certification exam passed with {examScorePercent}, and{" "}
            {challengeCount} hands-on{" "}
            {challengeCount === 1 ? "challenge" : "challenges"} verified against
            real records created in Carbon.
          </Text>
        </View>

        <View style={tw("flex-1")} />

        <View style={tw("flex flex-row justify-between items-end")}>
          <View>
            <Text style={{ ...tw("text-gray-500"), fontSize: 9 }}>
              Issued {formatDay(issuedAt)} · Valid until {formatDay(expiresAt)}
            </Text>
            <Text style={{ ...tw("text-gray-500 mt-1"), fontSize: 9 }}>
              Content version {contentVersion}
            </Text>
            <Text style={{ ...tw("text-gray-500 mt-3"), fontSize: 9 }}>
              Verify at {verifyUrl}
            </Text>
            <Text style={{ ...tw("text-gray-400 mt-1"), fontSize: 8 }}>
              {verificationCode}
            </Text>
          </View>
          <Image src={qrDataUrl} style={{ width: 84, height: 84 }} />
        </View>
      </View>
    </Page>
  </Document>
);

export default LearnCertificatePDF;
