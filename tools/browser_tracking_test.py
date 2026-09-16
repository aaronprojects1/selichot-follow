"""Browser integration: real DOM/matcher with controlled browser speech events."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True, args=[
        "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
    context = browser.new_context(viewport={"width":390,"height":844}, permissions=["microphone"])
    context.add_init_script("""
      window.speechInstances = [];
      window.SpeechRecognition = class {
        constructor() { window.speechInstances.push(this); }
        start() { setTimeout(() => this.onstart?.(), 0); }
        abort() {}
      };
      window.emitWords = (text) => {
        const result = [{transcript:text,confidence:0.95}];
        result.isFinal = true;
        window.speechInstances.at(-1).onresult({ resultIndex:0, results:[result] });
      };
    """)
    page = context.new_page()
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('https://www.sefaria.org/**', lambda route: route.abort())
    import os
    page.goto(os.environ.get('SELICHOT_TEST_URL', 'http://127.0.0.1:8765'))
    page.wait_for_function("Number(document.querySelector('#total-count').textContent)>1000")
    assert not page.locator('#retry-listener').is_visible()
    page.locator('#listen-button').click()
    page.wait_for_function('window.speechInstances.length===1')
    start=int(page.locator('.is-current.prayer-card').get_attribute('data-index'))
    visited=[]
    for index in range(start+1,start+5):
        phrase=page.locator('.prayer-card__hebrew').nth(index).text_content()
        page.evaluate('(text)=>window.emitWords(text)',phrase)
        page.wait_for_timeout(100)
        visited.append(int(page.locator('.is-current.prayer-card').get_attribute('data-index')))
    assert visited[-1] > start, (start,visited)
    assert page.locator('#reader-scroll').evaluate('(e)=>e.scrollTop') > 0
    assert page.locator('html').evaluate('(e)=>e.scrollWidth') <= 390
    page.evaluate("window.speechInstances.at(-1).onerror({error:'audio-capture'})")
    page.wait_for_function('window.speechInstances.length===2')
    assert page.locator('#retry-listener').is_visible()
    page.evaluate('(text)=>window.emitWords(text)',phrase)
    assert not page.locator('#retry-listener').is_visible()
    page.evaluate("window.speechInstances.at(-1).onerror({error:'not-allowed'})")
    assert 'unavailable' in page.locator('#status-text').text_content()
    page.locator('#retry-listener').click()
    page.wait_for_function('window.speechInstances.length===3')
    page.locator('#listen-button').click()
    count=page.evaluate('window.speechInstances.length')
    page.wait_for_timeout(1000)
    assert page.evaluate('window.speechInstances.length') == count
    page.screenshot(path='tools/tracking-mobile.png')
    # Verify the installed offline shell includes the complete service.
    page.wait_for_function('navigator.serviceWorker.controller !== null')
    context.set_offline(True)
    page.evaluate('localStorage.clear()')
    page.reload()
    page.wait_for_function("Number(document.querySelector('#total-count').textContent)>1000")
    assert not errors, errors
    print(json.dumps({"start":start,"visited":visited,"offlineTotal":page.locator('#total-count').text_content(),"errors":errors}))
    browser.close()
