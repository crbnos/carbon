/**
 * Ponyfill of the HTMLFormElement.requestSubmit() method.
 * Based on polyfill from: https://github.com/javan/form-request-submit-polyfill/blob/main/form-request-submit-polyfill.js
 */
export const requestSubmit = (
  element: HTMLFormElement,
  submitter?: HTMLElement
) => {
  // In vitest, let's test the polyfill.
  // Cypress will test the native implementation by nature of using chrome.
  if (typeof Object.getPrototypeOf(element).requestSubmit === "function") {
    element.requestSubmit(submitter);
    return;
  }

  if (submitter) {
    validateSubmitter(element, submitter);
    submitter.click();
    return;
  }

  const dummySubmitter = document.createElement("input");
  dummySubmitter.type = "submit";
  dummySubmitter.hidden = true;
  element.appendChild(dummySubmitter);
  dummySubmitter.click();
  element.removeChild(dummySubmitter);
};

function validateSubmitter(element: HTMLFormElement, submitter: HTMLElement) {
  // Should be redundant, but here for completeness
  const isHtmlElement = submitter instanceof HTMLElement;
  if (!isHtmlElement) {
    raise(TypeError, "parameter 1 is not of type 'HTMLElement'");
  }

  const hasSubmitType =
    "type" in submitter && (submitter as HTMLInputElement).type === "submit";
  if (!hasSubmitType)
    raise(TypeError, "The specified element is not a submit button");

  const isForCorrectForm =
    "form" in submitter && (submitter as HTMLInputElement).form === element;
  if (!isForCorrectForm)
    raise(
      DOMException,
      "The specified element is not owned by this form element",
      "NotFoundError"
    );
}

interface ErrorConstructor {
  new (message: string, name?: string): Error;
}

function raise(
  errorConstructor: ErrorConstructor,
  message: string,
  name?: string
): never {
  throw new errorConstructor(
    "Failed to execute 'requestSubmit' on 'HTMLFormElement': " + message + ".",
    name
  );
}
