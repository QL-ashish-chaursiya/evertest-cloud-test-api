const { chromium } = require('playwright');
const { delay, normalizeUrl } = require('./utils');

class AutomationService {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
    }

    async init() {
        this.browser = await chromium.launch({
            headless: false, // Set to false to see the browser in action
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        this.context = await this.browser.newContext();
        this.page = await this.context.newPage();
    }

    async navigateTo(url) {
        if (!this.page) {
            throw new Error('Browser page not initialized. Call init() first.');
        }
        await this.page.goto(url, { waitUntil: 'networkidle' });
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
                    break; // Stop on failure
                }

                results.push(result);

                // Handle wait/delay
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
     * Locate element by xpath array or uniqueSelector
     * Tries multiple XPath options until one works
     */
    async locateElement(action) {
        try {
            if (action.element?.xpath) {
                const xpathArray = Array.isArray(action.element.xpath) 
                    ? action.element.xpath 
                    : [action.element.xpath];
                
                for (const xpath of xpathArray) {
                    try {
                        const selector = `xpath=${xpath}`;
                        const element = await this.page.waitForSelector(selector, { timeout: 3000 });
                        console.log(`✅ Element found with XPath: ${xpath}`);
                        return { element, failed: false };
                    } catch (e) {
                        console.warn(`❌ XPath failed: ${xpath}`);
                        continue;
                    }
                }
                return { element: null, failed: true };
            } else if (action.element?.uniqueSelector) {
                const element = await this.page.waitForSelector(action.element.uniqueSelector, { timeout: 10000 });
                return { element, failed: false };
            }
            return { element: null, failed: true };
        } catch (error) {
            return { element: null, failed: true };
        }
    }

    /**
     * Ensure element is clickable and visible
     * Tries multiple XPath options until one works
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
                    
                    // Check if element is visible
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

    
    async waitForNetworkIdle(timeout = 30000) {
        try {
            await this.page.waitForLoadState('networkidle', { timeout });
        } catch (error) {
            console.warn('Network idle timeout:', error.message);
        }
    }

    /**
     * Main action performer
     */
   
    async performAction(action, arr = [], index = 0) {
        try {
            // Detect iframe context
            let frame = this.page;
            if (action.isTopFrame === false && action.iframeIdentifier?.src) {
                // Find the iframe by src
                const iframeHandle = await this.page.$(`iframe[src="${action.iframeIdentifier.src}"]`);
                if (!iframeHandle) {
                    throw new Error(`Iframe with src ${action.iframeIdentifier.src} not found`);
                }
                frame = await iframeHandle.contentFrame();
                if (!frame) {
                    throw new Error(`Could not get frame for iframe src ${action.iframeIdentifier.src}`);
                }
            }

            switch (action.type) {
                case 'System_Navigate':
                    await frame.goto(action.url, { waitUntil: 'networkidle' });
                    return { success: true, message: `Navigated to ${action.url}` };

                case 'navigate': {
                    const expectedUrl = action.url;
                    const timeout = 10000;
                    const pollInterval = 1000;
                    let isMatch = false;
                    let elapsed = 0;

                    const normalizedExpected = normalizeUrl(expectedUrl);

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

                    return {
                        success: true,
                        message: isMatch
                            ? `Current URL matches expected (normalized): ${normalizeUrl(frame.url())}`
                            : `Current URL does not match expected: ${normalizeUrl(frame.url())} vs ${normalizedExpected}`
                    };
                }

                case 'mousedown': {
                    const nextAction = arr?.length - 1 > index && arr[index + 1]?.type === 'fileSelect';
                    if (nextAction) {
                        return { success: true, message: 'File input: click skipped to avoid file dialog' };
                    }

                    //await this.waitForNetworkIdle();

                    if (!action.element?.xpath) {
                        throw new Error('XPath required for mousedown action');
                    }

                    const clickResult = await this.ensureClickable(action.element.xpath, 10000);
                    if (!clickResult.success) {
                        return clickResult;
                    }

                    const selector = clickResult.selector;
                    const elementHandle = await frame.$(selector);
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
                    return { success: true, message: '✅ Mouse click simulated (isTrusted)' };
                }

                case 'change': {
                    if (!action.element?.xpath && !action.element?.uniqueSelector) {
                        throw new Error('XPath or uniqueSelector required for change action');
                    }

                    let selector = null;
                    if (action.element?.xpath) {
                        const xpathArray = Array.isArray(action.element.xpath)
                            ? action.element.xpath
                            : [action.element.xpath];
                        for (const xpath of xpathArray) {
                            try {
                                const sel = `xpath=${xpath}`;
                                const el = await frame.$(sel);
                                if (el) {
                                    selector = sel;
                                    break;
                                }
                            } catch (e) {
                                continue;
                            }
                        }
                    } else {
                        selector = action.element.uniqueSelector;
                    }

                    if (!selector) {
                        throw new Error('Element not found for change action');
                    }

                    const element = await frame.$(selector);
                    if (!element) {
                        throw new Error('Element not found for change action');
                    }

                    await frame.focus(selector);
                    await frame.fill(selector, '');
                    await delay(100);
                    // Use page.type for human-like typing
                    await frame.type(selector, action.value, { delay: 100 });

                    // Dispatch input and change events, handling xpath= selectors
                    await frame.evaluate(({ selector, value }) => {
                        let el;
                        if (selector.startsWith('xpath=')) {
                            const xpath = selector.replace('xpath=', '');
                            el = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                        } else {
                            el = document.querySelector(selector);
                        }
                        if (el) {
                            el.value = value;
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }, { selector, value: action.value });

                    return { success: true, message: 'Successfully changed value (typed)' };
                }

                case 'hover': {
                    if (!action.element?.xpath && !action.element?.uniqueSelector) {
                        throw new Error('XPath or uniqueSelector required for hover action');
                    }

                    let selector = null;
                    
                    if (action.element?.xpath) {
                        const xpathArray = Array.isArray(action.element.xpath) 
                            ? action.element.xpath 
                            : [action.element.xpath];
                        
                        for (const xpath of xpathArray) {
                            try {
                                const sel = `xpath=${xpath}`;
                                const el = await this.page.$(sel);
                                if (el) {
                                    selector = sel;
                                    break;
                                }
                            } catch (e) {
                                continue;
                            }
                        }
                    } else {
                        selector = action.element.uniqueSelector;
                    }

                    if (!selector) {
                        throw new Error('Element not found for hover action');
                    }

                    await this.page.hover(selector);
                    return { success: true, message: 'Successfully hovered' };
                }

                case 'scroll': {
                    if (action.containerXPath) {
                        // Scroll specific container
                        await this.page.evaluate(({ xpath, scrollX, scrollY }) => {
                            const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                            const container = result.singleNodeValue;
                            if (container) {
                                container.scrollTo({ left: scrollX || 0, top: scrollY || 0, behavior: 'smooth' });
                            }
                        }, { xpath: action.containerXPath[0], scrollX: action.scrollX, scrollY: action.scrollY });
                    } else {
                        // Scroll window
                        await this.page.evaluate(({ x, y }) => {
                            window.scrollTo({ left: x || 0, top: y || 0, behavior: 'smooth' });
                        }, { x: action.scrollX, y: action.scrollY });
                    }
                    await delay(1000);
                    return { success: true, message: `Scroll to (${action.scrollX}, ${action.scrollY}) successful` };
                }

                case 'Enter':
                case 'Tab':
                case 'ArrowUp':
                case 'ArrowDown':
                case 'ArrowLeft':
                case 'ArrowRight':
                case 'Escape': {
                    await this.page.keyboard.press(action.type);
                    return { success: true, message: `✅ Simulated ${action.type} key` };
                }

                case 'fileSelect': {
                    if (!action.storageData) {
                        return { success: false, message: 'No file data found' };
                    }

                    if (!action.element?.xpath && !action.element?.uniqueSelector) {
                        throw new Error('XPath or uniqueSelector required for fileSelect action');
                    }

                    let selector = null;
                    
                    if (action.element?.xpath) {
                        const xpathArray = Array.isArray(action.element.xpath) 
                            ? action.element.xpath 
                            : [action.element.xpath];
                        
                        for (const xpath of xpathArray) {
                            try {
                                const sel = `xpath=${xpath}`;
                                const el = await this.page.$(sel);
                                if (el) {
                                    selector = sel;
                                    break;
                                }
                            } catch (e) {
                                continue;
                            }
                        }
                    } else {
                        selector = action.element.uniqueSelector;
                    }

                    if (!selector) {
                        throw new Error('Element not found for fileSelect action');
                    }

                    const fileData = action.storageData;

                    // Convert base64 to file and set
                    const byteString = atob(fileData.content.split(',')[1]);
                    const ab = new ArrayBuffer(byteString.length);
                    const ia = new Uint8Array(ab);
                    for (let i = 0; i < byteString.length; i++) {
                        ia[i] = byteString.charCodeAt(i);
                    }

                    const buffer = Buffer.from(ab);
                    await this.page.setInputFiles(selector, {
                        name: fileData.name,
                        mimeType: fileData.type,
                        buffer: buffer
                    });

                    return { success: true, message: `File "${fileData.name}" selected` };
                }
                   case "dragstart": {
    const { element, failed } = await this.locateElement(action);
    if (failed || !element) {
        return { success: false, message: "dragstart: element not found" };
    }

    const box = await element.boundingBox();
    if (!box) {
        return { success: false, message: "dragstart: cannot get bounding box" };
    }

    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    const client = await this.page.context().newCDPSession(this.page);

    // disable scrolling (same as background.js)
    await this.page.addStyleTag({
        content: `
            html, body {
                overflow: hidden !important;
                height: 100% !important;
                touch-action: none !important;
            }
        `
    });

    // move pointer to start point
    await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        button: "left",
        pointerType: "mouse",
    });

    // mouse down = start drag
    await client.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1,
        pointerType: "mouse",
    });

    return { success: true, message: "Drag started via Playwright CDP" };
}
 case "dragend": {
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

    // fallback (if no drop target found)
    if (x === null || y === null) {
        const fallback = await this.page.evaluate(() => ({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2
        }));
        x = fallback.x;
        y = fallback.y;
    }

    const client = await this.page.context().newCDPSession(this.page);

    // move pointer to drop point
    await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        buttons: 1,
        pointerType: "mouse",
    });

    // mouseReleased = drop
    await client.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1,
        pointerType: "mouse",
    });

    // re-enable scrolling
    await this.page.evaluate(() => {
        const style = document.getElementById("__no_scroll_style__");
        if (style) style.remove();
    });

    return { success: true, message: "Drag ended via Playwright CDP" };
}

               

                

                default:
                    console.warn(`Unsupported action type: ${action.type}`);
                    return { success: false, message: `Unsupported action type: ${action.type}` };
            }
        } catch (error) {
            console.error(`Action failed:`, error);
            return { success: false, message: error.message };
        }
    }
}

module.exports = AutomationService;
