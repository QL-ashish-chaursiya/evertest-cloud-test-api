/**
 * Delays execution for a specified number of milliseconds.
 * @param {number} ms - The number of milliseconds to wait.
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normalizes a URL by removing trailing slashes and ensuring consistency.
 * @param {string} url - The URL to normalize.
 * @returns {string} - The normalized URL.
 */
const normalizeUrl = (url) => {
    try {
        const urlObj = new URL(url);
        // Remove trailing slash from pathname if present
        if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
            urlObj.pathname = urlObj.pathname.slice(0, -1);
        }
        return urlObj.href;
    } catch (e) {
        return url;
    }
};
 async function runAssertions(action,page, element) {
   
  const results = [];
  const assertions = action.assertions || {};
 
  for (const [type, assertion] of Object.entries(assertions)) {
    console.log("type",type)
    const expected = assertion.value || "";
    let success = true;
    let message = "";

    switch (type) {
      case 'ValidEmail':
        success = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(element?.value || "");
        message = success ? "Valid email" : "Invalid email";
        break;
      case 'formHasValue':
        success = (element?.value || "") === expected;
        message = success
          ? "Value matches"
          : `Value is "${element?.value}", expected "${expected}"`;
        break;
      case 'pageHasTitle': {
  const title = await page.title();
  success = title.toLowerCase().includes(expected.toLowerCase());
  message = success
    ? "Title includes value"
    : `Title does not include "${expected}"`;
  break;
}

      case 'pageHasText': {
  const pageText = await page.evaluate(() =>
    document.body.innerText.toLowerCase()
  );
  success = pageText.includes(expected.toLowerCase());
  message = success
    ? "Page contains expected text"
    : `Page does not contain "${expected}"`;
  break;
}

      case 'elementHasText':
        const actualText = element?.textContent?.trim().toLowerCase() || "";
        success = actualText.includes(expected.toLowerCase());
        message = success
          ? "Element has expected text"
          : `Text "${expected}" not found in element`;
        break;
             case "elementIsVisible": {
  success = false;

  if (!element?.xpath?.length) {
    message = "No xpath available to locate element";
    break;
  }

  for (const xp of element.xpath) {
    const locator = page.locator(`xpath=${xp}`);

    try {
      if (await locator.count() > 0 && await locator.first().isVisible()) {
        success = true;
        break;
      }
    } catch (e) {
      // ignore invalid xpath / detached element
    }
  }

  message = success ? "Element is visible" : "Element is not visible";
  break;
}




       case "downloadStarted": {
  try {
    const download = await page.waitForEvent("download", {
      timeout: 5000, // 5s timeout (adjust if needed)
    });

    success = !!download;
    message = success
      ? "Download has started"
      : "Expected download to start, but it did not";
  } catch (err) {
    success = false;
    message = "Expected download to start, but it did not within timeout";
  }
  break;
}

      default:
        message = `⚠️ Unsupported assertion: ${type}`;
        success = false;
        break;
    }
    const updatedMessage = success ? message : 'Assertion failed: ' + message;
    results.push({ type, message: updatedMessage, success });
    if (!success) {
      break;
    }
  }
  return results;
}
 function resolveVariableValue(variable) {
  if (!variable) return "";
const IS_CUSTOM = ['randomName','randomNumber','randomAlphaNumeric','randomEmail']
  // 🧩 Built-in variable generators
  const generateRandomString = (len = 10) =>
    Array.from({ length: len }, () =>
      String.fromCharCode(Math.floor(Math.random() * 26) + 97)
    ).join("");

  const generateRandomNumber = (len = 10) =>
    Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join("");

  const generateAlphaNumeric = (len = 10) => {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length: len }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join("");
  };

  const generateRandomEmail = (len = 10) => {
    const name = generateAlphaNumeric(Math.max(4, len));
    return `${name.toLowerCase()}@example.com`;
  };

  // 🧠 Built-in variable logic
  const { name, length, value } = variable;
 
  if (IS_CUSTOM.includes(name)) {
    switch (name) {
      case "randomName":
        return generateRandomString(length);
      case "randomNumber":
        return generateRandomNumber(length);
      case "randomAlphaNumeric":
        return generateAlphaNumeric(length);
      case "randomEmail":
        return generateRandomEmail(length);
      default:
        return ""; // unknown built-in
    }
  }

  // 🧾 Custom variable (use stored value)
  return value || "";
}
module.exports = {
    delay,
    normalizeUrl,
    runAssertions,
    resolveVariableValue
};
