import InviteEmail from "../InviteEmail";

// Preview fixture — mirrors the invite sent by the user-admin job
// (packages/jobs/.../tasks/user-admin.ts) when an employee/supplier/customer
// user is created or an invite is resent. Not shipped (not exported from
// index.ts).
export default function InviteEmailPreview() {
  return (
    <InviteEmail
      email={"jane.doe@tombstone.ms"}
      name={"Jane Doe"}
      invitedByEmail={"tom@sawyer.com"}
      invitedByName={"Tom Sawyer"}
      companyName={"Tombstone Machine Works"}
      inviteLink={"https://app.carbon.ms/invite/a1b2c3d4e5f6"}
      ip={"73.162.44.10"}
      location={"Austin, TX"}
    />
  );
}
