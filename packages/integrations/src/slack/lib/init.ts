export const onInitialize = async () => {
  const response = await fetch("/api/integrations/slack/install").then((res) =>
    res.json()
  );

  const { url } = response;

  const width = 600;
  const height = 800;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2.5;

  const popup = window.open(
    url,
    "",
    `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${width}, height=${height}, top=${top}, left=${left}`
  );

  if (!popup) {
    window.location.href = url;
    return;
  }

  const listener = (e: MessageEvent) => {
    if (e.data === "app_oauth_completed") {
      window.location.reload();
      window.removeEventListener("message", listener);
      popup.close();
    }
  };

  window.addEventListener("message", listener);
};
