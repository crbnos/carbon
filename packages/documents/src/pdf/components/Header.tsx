import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Company } from "../../types";

type HeaderProps = {
  company: Company;
  title: string;
  subtitle?: string;
  tertiaryTitle?: string;
};

const styles = StyleSheet.create({
  header: {
    fontSize: 11,
    display: "flex",
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  logo: {
    height: 70,
  },
  titleWithoutSubtitle: {
    height: 70,
    fontSize: 26,
    letterSpacing: -1,
    fontWeight: 700,
  },
  title: {
    fontSize: 26,
    letterSpacing: -1,
    fontWeight: 700,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: 500,
    color: "gray",
  },
  tertiaryTitle: {
    fontSize: 12,
    fontWeight: 400,
    color: "gray",
  },
  jobHeader: {
    fontSize: 10,
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
    gap: 20,
  },
  leftSection: {
    flex: 1,
  },
  rightSection: {
    flex: 1,
  },
  infoRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  label: {
    fontSize: 9,
    fontWeight: 600,
    color: "#374151",
  },
  value: {
    fontSize: 9,
    fontWeight: 400,
    color: "#111827",
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 8,
    color: "#111827",
    borderBottom: "1px solid #d1d5db",
    paddingBottom: 2,
  },
});

const Header = ({ title, subtitle, tertiaryTitle, company }: HeaderProps) => {
  return (
    <View style={styles.header}>
      <View>
        {company.logoLightIcon && (
          <View>
            <Image src={company.logoLightIcon} style={styles.logo} />
          </View>
        )}
      </View>
      <View>
        <Text style={subtitle ? styles.title : styles.titleWithoutSubtitle}>
          {title}
        </Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        {tertiaryTitle && (
          <Text style={styles.tertiaryTitle}>{tertiaryTitle}</Text>
        )}
      </View>
    </View>
  );
};

export { Header };
