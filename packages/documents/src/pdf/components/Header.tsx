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

export default Header;
