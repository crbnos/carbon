import axios from "axios";
import { path } from "~/utils/path";
import type { AutodeskToken } from "./types";

export enum AutodeskKeysEnum {
  AUTODESK_TOKEN = "autodesk-token",
  AUTODESK_TOKEN_RENEW = "autodesk-token-renew",
}

// when expiry time of token is less than 3 minutes.
const RENEW_TOKEN_TIME = 180 * 1000;
const TOKEN_CHECKER_INTERVAL = 15 * 1000; //  every 15 sec

let tokenCheckerTimerId: ReturnType<typeof setInterval> | null = null;

const autodesk = {
  _isRenewing: false,

  clear() {
    this._stopTokenChecker();
    this.unsubscribe(receiveMessage);
    window.localStorage.removeItem(AutodeskKeysEnum.AUTODESK_TOKEN);
    window.localStorage.removeItem(AutodeskKeysEnum.AUTODESK_TOKEN_RENEW);
  },

  // ensureToken verifies that token is valid and starts
  // periodically checking and refreshing the token.
  ensureToken() {
    this._stopTokenChecker();
    this._ensureLocalStorageSubscription();

    if (this._shouldRenewToken()) {
      this._renewToken()
        .then(() => {
          this._startTokenChecker();
        })
        .catch(this.renewToken.bind(this));
    } else {
      this._startTokenChecker();
    }
  },

  renewToken(): Promise<number> {
    return this._renewToken().then((token) => token.expiresAt);
  },

  isValid(): boolean {
    return this._timeLeft() > 0;
  },

  getInactivityTimeout(): number {
    const autodeskToken = this._getAutodeskToken();
    if (autodeskToken === null) return 0;
    const time = Number(autodeskToken.expiresAt);
    return time ? time : 0;
  },

  _getAutodeskToken() {
    let token = null;
    try {
      token = this.getAutodeskToken();
    } catch (err) {
      console.error("Cannot find bearer token", err);
    }

    return token;
  },

  _shouldRenewToken(): boolean {
    if (this._getIsRenewing()) {
      return false;
    }

    return this._timeLeft() < RENEW_TOKEN_TIME;
  },

  _renewToken() {
    this._setAndBroadcastIsRenewing(true);
    return axios.get(path.to.api.autodeskToken).then((response) => {
      const token = response.data;
      this.setAutodeskToken(token);
      this._setAndBroadcastIsRenewing(false);
      return token;
    });
  },

  _setAndBroadcastIsRenewing(value: boolean) {
    this._setIsRenewing(value);
    this.broadcast(AutodeskKeysEnum.AUTODESK_TOKEN_RENEW, `${value}`);
  },

  _setIsRenewing(value: boolean) {
    this._isRenewing = value;
  },

  _getIsRenewing() {
    return !!this._isRenewing;
  },

  _timeLeft() {
    const token = this._getAutodeskToken();
    if (!token) {
      return 0;
    }

    let { expiresAt } = token;
    if (!expiresAt) {
      return 0;
    }

    return expiresAt - Date.now();
  },

  _shouldCheckStatus() {
    if (this._getIsRenewing()) {
      return false;
    }

    /*
     * double the threshold value for slow connections to avoid
     * access-denied response due to concurrent renew token request
     * made from other tab
     */
    return this._timeLeft() > TOKEN_CHECKER_INTERVAL * 2;
  },

  // subsribes to localStorage changes (triggered from other browser tabs)
  _ensureLocalStorageSubscription() {
    this.subscribe(receiveMessage);
  },

  _startTokenChecker() {
    this._stopTokenChecker();

    tokenCheckerTimerId = setInterval(() => {
      // calling ensureToken() will again invoke _startTokenChecker
      this.ensureToken();
    }, TOKEN_CHECKER_INTERVAL);
  },

  _stopTokenChecker() {
    clearInterval(tokenCheckerTimerId ?? undefined);
    tokenCheckerTimerId = null;
  },

  subscribe(fn: (event: StorageEvent) => void) {
    window.addEventListener("storage", fn);
  },

  unsubscribe(fn: (event: StorageEvent) => void) {
    window.removeEventListener("storage", fn);
  },

  setAutodeskToken(token: AutodeskToken) {
    window.localStorage.setItem(
      AutodeskKeysEnum.AUTODESK_TOKEN,
      JSON.stringify(token)
    );
  },

  getAutodeskToken(): AutodeskToken | null {
    const item = window.localStorage.getItem(AutodeskKeysEnum.AUTODESK_TOKEN);
    if (item) {
      return JSON.parse(item);
    }

    return null;
  },

  broadcast(messageType: string, messageBody: string) {
    window.localStorage.setItem(messageType, messageBody);
    window.localStorage.removeItem(messageType);
  },
};

function receiveMessage(event: StorageEvent) {
  const { key, newValue } = event;

  // check if token is being renewed from another tab
  if (key === AutodeskKeysEnum.AUTODESK_TOKEN_RENEW && !!newValue) {
    autodesk._setIsRenewing(JSON.parse(newValue));
  }
}

export default autodesk;
