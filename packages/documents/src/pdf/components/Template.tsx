import { Document, Font, Page, StyleSheet } from "@react-pdf/renderer";
import type { PropsWithChildren } from "react";
import type { Meta } from "../../types";

type TemplateProps = PropsWithChildren<{ title: string; meta: Meta }>;

const Template = ({ title, meta, children }: TemplateProps) => {
  Font.register({
    family: "Inter",
    fonts: [
      {
        src: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfMZhrib2Bg-4.ttf",
      },
      {
        src: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuOKfMZhrib2Bg-4.ttf",
        fontWeight: 300,
      },
      {
        src: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuI6fMZhrib2Bg-4.ttf",
        fontWeight: 500,
      },
      {
        src: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuFuYMZhrib2Bg-4.ttf",
        fontWeight: 700,
      },
      {
        src: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuBWYMZhrib2Bg-4.ttf",
        fontWeight: 900,
      },
    ],
  });

  const styles = StyleSheet.create({
    body: {
      fontFamily: "Inter",
      padding: "20px 40px",
      color: "#000000",
      backgroundColor: "#FFFFFF",
    },
  });

  return (
    <Document
      author={meta?.author ?? "Carbon"}
      keywords={meta?.keywords}
      subject={meta?.subject}
      title={title}
    >
      <Page size="A4" style={styles.body}>
        {children}
      </Page>
    </Document>
  );
};

export default Template;
