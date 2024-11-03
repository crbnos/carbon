import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Company } from "../../types";

type HeaderProps = {
  company: Company;
  title: string;
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
  title: {
    height: 70,
    fontSize: 26,
    letterSpacing: -1,
    fontWeight: 700,
  },
});

const Header = ({ title, company }: HeaderProps) => {
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
        <Text style={styles.title}>{title}</Text>
      </View>
    </View>
  );
};

export default Header;
