import { config } from "dotenv";

config();

const website = "https://carbon.ms";

(async () => {
  const twentyPerson = await fetch("https://api.twenty.com/rest/people", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TWENTY_API_KEY}`,
    },
    body: JSON.stringify({
      name: {
        firstName: "Brad",
        lastName: "Barbin",
      },
      emails: {
        primaryEmail: "brad@carbon.ms",
      },
      customerStatus: ["PROSPECTIVE_CUSTOMER"],
      location: "Johnstown, PA",
    }),
  });

  if (!twentyPerson.ok) {
    throw new Error(
      `Twenty CRM API error: ${twentyPerson.status} ${twentyPerson.statusText}`
    );
  }

  const twentyData = await twentyPerson.json();
  const personId = twentyData.data?.createPerson?.personId;
  console.log({ personId });

  const twentyCompany = await fetch("https://api.twenty.com/rest/companies", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TWENTY_API_KEY}`,
    },
    body: JSON.stringify({
      name: "Carbon",
      domainName: {
        primaryLinkLabel: removeProtocolFromWebsite(website),
        primaryLinkUrl: ensureProtocolFromWebsite(website),
        additionalLinks: [],
      },
    }),
  });

  if (!twentyCompany.ok) {
    throw new Error(
      `Twenty CRM API error: ${twentyCompany.status} ${twentyCompany.statusText}`
    );
  }

  const twentyCompanyData = await twentyCompany.json();
  console.log(twentyCompanyData);

  const twentyCompanyId = twentyCompanyData.data?.createCompany?.id;

  console.log({ twentyCompanyId });
})();

function removeProtocolFromWebsite(website: string) {
  return website.replace(/^https?:\/\//, "").replace(/^www\./, "");
}

function ensureProtocolFromWebsite(website: string) {
  return website.startsWith("http") ? website : `https://${website}`;
}
