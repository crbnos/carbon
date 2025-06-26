import { useOptionalUser } from "~/hooks/useUser";

export default function IndexRoute() {
  const user = useOptionalUser();
  return (
    <p>
      Oops. You shouldn't see this page. Eventually it will be a landing page.
    </p>
  );
}
