# Email

> Send outbound email through Carbon-managed Resend or your own SMTP server.

## Email

Email is how Carbon sends transactional mail: order confirmations, notifications, and the like. It's
available on **every plan**, and you choose who actually delivers the mail.

  
  ### Choose a provider

  Pick **Resend** (Carbon-managed) or **SMTP** (your own server). The fields below change to match your choice.
  
  
  ### Fill in the provider fields

  For **Resend**, enter your API key. For **SMTP**, enter the host and port (default `587`), username and password, and whether to connect over TLS. Set the **from address** either way.
  

  - **Provider**: **Resend** (Carbon-managed) or **SMTP** (your own server).
  - **From address**: The address outbound mail is sent from.
  - **API key**: *(Resend)* Your Resend API key.
  - **Host / Port**: *(SMTP)* Your mail server and port (default `587`).
  - **Username / Password**: *(SMTP)* Credentials for the SMTP server.
  - **Secure**: *(SMTP)* Whether to connect over TLS.

The Resend and SMTP fields are shown only for the provider you pick — choose **SMTP** to route mail through
your own server, or **Resend** to let Carbon handle delivery.
