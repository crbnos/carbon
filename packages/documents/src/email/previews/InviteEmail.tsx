import InviteEmail from "../InviteEmail";

export default function InviteEmailPreview() {
  return (
    <InviteEmail
      email={"john.doe@tombstone.ms"}
      name={"John Doe"}
      invitedByEmail={"tom@sawyer.com"}
      invitedByName={"Tom Sawyer"}
      companyName={"Tombstone Machine Works"}
      inviteLink={"https://app.carbon.ms/invite/a1b2c3d4e5f6"}
      ip={"73.162.44.10"}
      location={"Austin, TX"}
    />
  );
}
