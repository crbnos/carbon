import { describe, expect, it } from "vitest";
import {
  isOnshapeServerOrigin,
  isPanelSessionMessage,
  parsePanelContext
} from "./messages";

describe("isOnshapeServerOrigin", () => {
  it("accepts cad, enterprise and dev origins", () => {
    expect(isOnshapeServerOrigin("https://cad.onshape.com")).toBe(true);
    expect(isOnshapeServerOrigin("https://acme.onshape.com")).toBe(true);
    expect(isOnshapeServerOrigin("https://demo-c.dev.onshape.com")).toBe(true);
  });

  it("rejects look-alikes, http and paths", () => {
    expect(isOnshapeServerOrigin("https://onshape.com.evil.io")).toBe(false);
    expect(isOnshapeServerOrigin("http://cad.onshape.com")).toBe(false);
    expect(isOnshapeServerOrigin("https://cad.onshape.com/x")).toBe(false);
    expect(isOnshapeServerOrigin(null)).toBe(false);
  });
});

describe("parsePanelContext", () => {
  it("reads the action-url parameters and the Onshape-appended ones", () => {
    const { context, serverOrigin } = parsePanelContext(
      new URLSearchParams(
        "documentId=d1&wv=w&wvId=w1&elementId=e1&partNumber=&revision=&nodeId=n1&occurrencePath=&configuration=default&server=https://cad.onshape.com&companyId=c1&userId=u1&locale=en_US&clientId=abc"
      )
    );
    expect(context.documentId).toBe("d1");
    expect(context.wv).toBe("w");
    expect(context.wvId).toBe("w1");
    expect(context.elementId).toBe("e1");
    expect(context.partNumber).toBeNull();
    expect(context.nodeId).toBe("n1");
    expect(context.configuration).toBe("default");
    expect(context.companyId).toBe("c1");
    expect(serverOrigin).toBe("https://cad.onshape.com");
  });

  it("treats an unresolved placeholder as absent", () => {
    const { context } = parsePanelContext(
      new URLSearchParams(
        "partNumber=%7B%24partNumber%7D&revision=%7B%24revision%7D&configuration=%7B%24configuration%7D&nodeId=n1"
      )
    );
    expect(context.partNumber).toBeNull();
    expect(context.revision).toBeNull();
    expect(context.configuration).toBeNull();
    expect(context.nodeId).toBe("n1");
  });

  it("drops an untrusted server and an unknown wv", () => {
    const { context, serverOrigin } = parsePanelContext(
      new URLSearchParams("wv=x&server=https://evil.example")
    );
    expect(context.wv).toBeNull();
    expect(serverOrigin).toBeNull();
  });
});

describe("isPanelSessionMessage", () => {
  it("requires the type and a string token", () => {
    expect(
      isPanelSessionMessage({
        type: "carbon_onshape_panel_session",
        token: "cps_x"
      })
    ).toBe(true);
    expect(
      isPanelSessionMessage({ type: "carbon_onshape_panel_session" })
    ).toBe(false);
    expect(isPanelSessionMessage("carbon_onshape_panel_session")).toBe(false);
  });
});
