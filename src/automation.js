const { chromium } = require('playwright');
const { delay, normalizeUrl, runAssertions } = require('./utils');

class AutomationService {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
    }

    async init() {
        this.browser = await chromium.launch({
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        this.context = await this.browser.newContext();
        this.page = await this.context.newPage();
    }

    async navigateTo(url) {
        if (!this.page) {
            throw new Error('Browser page not initialized. Call init() first.');
        }
        await this.page.goto(url, { waitUntil: 'load' });
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }

    async runActions(actions) {
        const results = [];

        try {
            for (let i = 0; i < actions.length; i++) {
                const action = actions[i];
                console.log(`Executing step ${i + 1}: ${action.type}`);

                let result = {
                    sequence: action.sequence || i + 1,
                    description: action.description || action.type,
                    status: 'pending',
                    message: ''
                };

                try {
                    const actionResult = await this.performAction(action, actions, i);
                    result.status = actionResult.success ? 'pass' : 'fail';
                    result.message = actionResult.message || 'Success';
                } catch (error) {
                    console.error(`Step ${i + 1} failed:`, error);
                    result.status = 'fail';
                    result.message = error.message;
                    results.push(result);
                    break;
                }

                results.push(result);

                const finalWait = action.wait !== undefined ? action.wait : 1;
                await delay(finalWait * 1000);
            }
        } catch (err) {
            console.error('Global execution error:', err);
        } finally {
            await this.close();
        }

        return results;
    }

    /**
     * Reusable XPath resolver - tries multiple XPaths and returns the first valid one
     */
    async resolveSelector(element, frame, timeout = 3000) {
        if (!element) {
            return { selector: null, found: false };
        }

        // Handle uniqueSelector first
        if (element.uniqueSelector) {
            try {
                const el = await frame.waitForSelector(element.uniqueSelector, { timeout });
                if (el) {
                    return { selector: element.uniqueSelector, found: true, element: el };
                }
            } catch (e) {
                console.warn(`❌ uniqueSelector failed: ${element.uniqueSelector}`);
            }
        }

        // Handle XPath (single or array)
        if (element.xpath) {
            const xpathArray = Array.isArray(element.xpath) ? element.xpath : [element.xpath];
            
            for (const xpath of xpathArray) {
                try {
                    const selector = `xpath=${xpath}`;
                    const el = await frame.waitForSelector(selector, { timeout });
                    if (el) {
                        console.log(`✅ Element found with XPath: ${xpath}`);
                        return { selector, found: true, element: el };
                    }
                } catch (e) {
                    console.warn(`❌ XPath failed: ${xpath}`);
                    continue;
                }
            }
        }

        return { selector: null, found: false, element: null };
    }

    /**
     * Locate element by xpath array or uniqueSelector (legacy method - uses resolveSelector)
     */
    async locateElement(action) {
        const result = await this.resolveSelector(action.element, this.page);
        return { 
            element: result.element, 
            failed: !result.found 
        };
    }

    /**
     * Ensure element is clickable and visible
     */
    async ensureClickable(xpath, timeout = 10000) {
        try {
            const xpathArray = Array.isArray(xpath) ? xpath : [xpath];
            
            for (const xp of xpathArray) {
                try {
                    const selector = `xpath=${xp}`;
                    await this.page.waitForSelector(selector, { timeout: 3000 });
                    const element = await this.page.$(selector);
                    
                    if (!element) continue;
                    
                    const isVisible = await this.page.evaluate((el) => {
                        return el.offsetParent !== null;
                    }, element);
                    
                    if (isVisible) {
                        console.log(`✅ Element is clickable with XPath: ${xp}`);
                        return { success: true, message: 'Element is clickable', selector };
                    }
                } catch (e) {
                    console.warn(`❌ XPath check failed: ${xp}`);
                    continue;
                }
            }
            
            return { success: false, message: 'Element is not visible' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    async waitForNetworkIdle(timeout = 20000) {
        try {
            console.log('⏳ Waiting for network idle...');
            await this.page.waitForLoadState('networkidle', { timeout });
            console.log('✅ Network is idle');
        } catch (error) {
            console.warn('⚠️ Network idle timeout:', error.message);
            // Continue execution even if timeout occurs
        }
    }

    /**
     * Get the correct frame context (main page or iframe)
     */
     normalizePath(path) {
  return path
    .split('/')                 
    .filter(Boolean)               
    .filter(segment => !isIdSegment(segment)) 
    .join('/');
}
async waitForIframeBySrc(refSrc, timeoutMs = 30000, intervalMs = 500) {
  const recorded = new URL(refSrc);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const frames = this.page.frames();
   console.log("all frames",frames)
    for (const frame of frames) {
      try {
        if (!frame.url()) continue;

        const current = new URL(frame.url());
      console.log("current",normalizePath(current.pathname))
        console.log("recorded",normalizePath(recorded.pathname))
        const sameOrigin =
          current.origin === recorded.origin;

        const samePath =
          normalizePath(current.pathname) ===
          normalizePath(recorded.pathname);

        if (sameOrigin && samePath) {
          console.log("✅ Found iframe:", frame.url());
          return frame;
        }
      } catch (e) {
        // ignore invalid URLs
      }
    }

    await this.page.waitForTimeout(intervalMs);
  }

  throw new Error(`⏱️ Iframe not found within ${timeoutMs}ms for ${refSrc}`);
}

    async getFrameContext(action) {
  if (action.isTopFrame === false && action.iframeIdentifier?.src) {
    return await this.waitForIframeBySrc(action.iframeIdentifier.src);
  }

  return this.page;
}


    /**
     * Dispatch events on an element (handles xpath= prefix)
     */
    async dispatchEvents(frame, selector, value, events = ['input', 'change']) {
        await frame.evaluate(({ selector, value, events }) => {
            let el;
            if (selector.startsWith('xpath=')) {
                const xpath = selector.replace('xpath=', '');
                el = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            } else {
                el = document.querySelector(selector);
            }
            if (el) {
                if (value !== undefined) {
                    el.value = value;
                }
                events.forEach(eventName => {
                    el.dispatchEvent(new Event(eventName, { bubbles: true }));
                });
            }
        }, { selector, value, events });
    }

    /**
     * Main action performer
     */
    async performAction(action, arr = [], index = 0) {
         let  success = false;
  let  message = "";
  let assertions = [];
        try {
            const frame = await this.getFrameContext(action);

            // Wait for network idle before performing any action (except navigation actions)
            const skipNetworkIdleFor = ['System_Navigate', 'navigate'];
            if (!skipNetworkIdleFor.includes(action.type)) {
               // await this.waitForNetworkIdle(20000);
            }

            switch (action.type) {
                case 'System_Navigate':
                    await frame.goto(action.url, { waitUntil: 'networkidle' });
                     success =  true, 
                     message  = `Navigated to ${action.url}` ;
                     break

                case 'navigate': {
                    const normalizedExpected = normalizeUrl(action.url);
                    const timeout = 10000;
                    const pollInterval = 1000;
                    let isMatch = false;
                    let elapsed = 0;

                    while (elapsed < timeout) {
                        const currentUrl = frame.url();
                        const normalizedCurrent = normalizeUrl(currentUrl);
                        if (normalizedCurrent === normalizedExpected) {
                            isMatch = true;
                            break;
                        }
                        await delay(pollInterval);
                        elapsed += pollInterval;
                    }
                     success =  true, 
                      message = isMatch
                            ? `Current URL matches expected (normalized): ${normalizeUrl(frame.url())}`
                            : `Current URL does not match expected: ${normalizeUrl(frame.url())} vs ${normalizedExpected}`
                     break
                    
                }

                case 'mousedown': {
                    const nextAction = arr?.length - 1 > index && arr[index + 1]?.type === 'fileSelect';
                    const isJsPopup = action.element.isAlert
                    if (nextAction || isJsPopup) {
                        return { success: true, message: 'File input: click skipped to avoid file dialog' };
                    }

                    if (!action.element?.xpath) {
                        throw new Error('XPath required for mousedown action');
                    }

                    const clickResult = await this.ensureClickable(action.element.xpath, 10000);
                    if (!clickResult.success) {
                        return clickResult;
                    }

                    const elementHandle = await frame.$(clickResult.selector);
                    if (!elementHandle) {
                        throw new Error('Element not found for mousedown action');
                    }
                    
                    const box = await elementHandle.boundingBox();
                    if (!box) {
                        throw new Error('Could not get bounding box for element');
                    }
                    
                    await frame.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                    await frame.mouse.down();
                    await frame.mouse.up();
                    success =  true, 
                     message  = `Mouse click simulated (isTrusted)` ;
                     break
                    
                }

                case 'change': {
                      const isJsPopup = action.element.isAlert
                    if (isJsPopup) {
                        return { success: true, message: 'change ignore in Js popup' };
                    }
    const resolved = await this.resolveSelector(action.element, frame);
    if (!resolved.found) throw new Error('Element not found for change action');

    // Identify element type
    const elementType = await frame.evaluate((selector) => {
        const el = selector.startsWith('xpath=')
            ? document.evaluate(selector.replace('xpath=', ''), document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
            : document.querySelector(selector);
        if (!el) return null;

        if (el.tagName === 'SELECT') return 'select';
        if (el.type === 'checkbox') return 'checkbox';
        if (el.type === 'radio') return 'radio';
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return 'text';

        return 'unknown';
    }, resolved.selector);

    if (!elementType) throw new Error("Unable to detect element type");

    // Handle according to element type
    if (elementType === 'text') {
        await frame.fill(resolved.selector, action.value || '');
        await this.dispatchEvents(frame, resolved.selector, action.value);
         success = true
          message = 'Text entered' 
          break
    }

     if (elementType === 'checkbox') {
    // 1. Try direct check()
    try {
        await frame.check(resolved.selector, { force: true });
        success = true
          message = 'Text entered' 
          break
    } catch (e) {
        // 2. Fallback: click the label
        const inputId = await frame.evaluate(selector => {
            const el = document.evaluate(selector.replace('xpath=', ''), document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            return el?.id || null;
        }, resolved.selector);

        if (inputId) {
            await frame.click(`label[for="${inputId}"]`, { force: true });
            success = true
          message = 'Text entered' 
          break
        }

        throw e;
    }
}


    if (elementType === 'radio') {
        await frame.check(resolved.selector);
          success = true
          message = 'Text entered' 
          break
    }

    if (elementType === 'select') {
        await frame.selectOption(resolved.selector, action.value);
         success = true
          message = 'Text entered' 
          break
    }

     success = false
          message = 'Unsupported Type' 
          break
}


                case 'hover': {
                    const resolved = await this.resolveSelector(action.element, this.page);
                    if (!resolved.found) {
                        throw new Error('Element not found for hover action');
                    }

                    await this.page.hover(resolved.selector);
                      success = true
          message = 'Hovered' 
          break
                }

                case 'scroll': {
                    if (action.containerXPath) {
                        await this.page.evaluate(({ xpath, scrollX, scrollY }) => {
                            const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                            const container = result.singleNodeValue;
                            if (container) {
                                container.scrollTo({ left: scrollX || 0, top: scrollY || 0, behavior: 'smooth' });
                            }
                        }, { xpath: action.containerXPath[0], scrollX: action.scrollX, scrollY: action.scrollY });
                    } else {
                        await this.page.evaluate(({ x, y }) => {
                            window.scrollTo({ left: x || 0, top: y || 0, behavior: 'smooth' });
                        }, { x: action.scrollX, y: action.scrollY });
                    }
                    await delay(1000);
                    
                     success = true
          message = `Scroll to (${action.scrollX}, ${action.scrollY}) successful`
          break
                }

                case 'Enter':
                case 'Tab':
                case 'ArrowUp':
                case 'ArrowDown':
                case 'ArrowLeft':
                case 'ArrowRight':
                case 'Escape':
                    await this.page.keyboard.press(action.type);
                       success = true
          message = `Successfully Pressed`
          break

                case 'fileSelect': {
                    if (!action.storageData) {
                        success = false
          message = `File error`
          break
                    }

                    const resolved = await this.resolveSelector(action.element, this.page);
                    if (!resolved.found) {
                        throw new Error('Element not found for fileSelect action');
                    }

                    const fileData = action.storageData;
                    const byteString = atob(fileData.content.split(',')[1]);
                    const ab = new ArrayBuffer(byteString.length);
                    const ia = new Uint8Array(ab);
                    for (let i = 0; i < byteString.length; i++) {
                        ia[i] = byteString.charCodeAt(i);
                    }

                    const buffer = Buffer.from(ab);
                    await this.page.setInputFiles(resolved.selector, {
                        name: fileData.name,
                        mimeType: fileData.type,
                        buffer: buffer
                    });

                   
                       success = true
          message =  `File "${fileData.name}" selected`
          break
                }

                case 'dragstart': {
                    const { element, failed } = await this.locateElement(action);
                    if (failed || !element) {
                       success = false
                      message =  `dragstart: element not found`
                       break
                    }

                    const box = await element.boundingBox();
                    if (!box) {
                        
                         success = false
                      message =   'dragstart: cannot get bounding box'
                       break
                    }

                    const x = box.x + box.width / 2;
                    const y = box.y + box.height / 2;

                    const client = await this.page.context().newCDPSession(this.page);

                    await this.page.addStyleTag({
                        content: `
                            html, body {
                                overflow: hidden !important;
                                height: 100% !important;
                                touch-action: none !important;
                            }
                        `
                    });

                    await client.send('Input.dispatchMouseEvent', {
                        type: 'mouseMoved',
                        x,
                        y,
                        button: 'left',
                        pointerType: 'mouse',
                    });

                    await client.send('Input.dispatchMouseEvent', {
                        type: 'mousePressed',
                        x,
                        y,
                        button: 'left',
                        clickCount: 1,
                        pointerType: 'mouse',
                    });

                    
                      success = true
                      message =    'Drag started via Playwright CDP'
                       break
                }

                case 'dragend': {
                    let x = null;
                    let y = null;

                    if (action.dropTarget?.xpath || action.dropTarget?.uniqueSelector) {
                        const { element, failed } = await this.locateElement({ element: action.dropTarget });
                        if (!failed && element) {
                            const box = await element.boundingBox();
                            if (box) {
                                x = box.x + box.width / 2;
                                y = box.y + box.height / 2;
                            }
                        }
                    }

                    if (x === null || y === null) {
                        const fallback = await this.page.evaluate(() => ({
                            x: window.innerWidth / 2,
                            y: window.innerHeight / 2
                        }));
                        x = fallback.x;
                        y = fallback.y;
                    }

                    const client = await this.page.context().newCDPSession(this.page);

                    await client.send('Input.dispatchMouseEvent', {
                        type: 'mouseMoved',
                        x,
                        y,
                        buttons: 1,
                        pointerType: 'mouse',
                    });

                    await client.send('Input.dispatchMouseEvent', {
                        type: 'mouseReleased',
                        x,
                        y,
                        button: 'left',
                        clickCount: 1,
                        pointerType: 'mouse',
                    });

                    await this.page.evaluate(() => {
                        const style = document.getElementById('__no_scroll_style__');
                        if (style) style.remove();
                    });

                    
                     success = true
                      message =    'Drag end via Playwright CDP'
                       break
                }

                default:
                    console.warn(`Unsupported action type: ${action.type}`);
                   
                     success = false
                      message =     `Unsupported action type: ${action.type}`
                       break
            }
             assertions = await runAssertions(action,this.page, action.element);
             console.log("assertions",assertions)
    const failedAssertions = assertions.some((a) => a.success == false);
    const failedMsg =
      assertions.find((a) => a.success == false)?.message ||
      "No failed assertions";
      
    return {
      success: success && !failedAssertions,
      message: failedAssertions ? failedMsg : message,
      assertions,
    };
        } catch (error) {
            console.error(`Action failed:`, error);
            return { success: false, message: error.message };
        }
    }
}

module.exports = AutomationService;