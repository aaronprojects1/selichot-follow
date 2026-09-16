"""Replay a supplied recording through Chrome's real microphone/Web Audio path."""
import json, subprocess
from pathlib import Path
import imageio_ffmpeg
from playwright.sync_api import sync_playwright
wav=Path('tools/replay-mic.wav').resolve()
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-y','-v','error','-i','PTT-20260827-WA0000.opus','-ac','1','-ar','48000',str(wav)],check=True)
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(channel='chrome',headless=True,args=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',f'--use-file-for-fake-audio-capture={wav}'])
  page=browser.new_page(permissions=['microphone'])
  errors=[]
  page.on('pageerror',lambda e: errors.append(str(e)))
  # Isolate local acoustic matching from the remote speech service.
  page.add_init_script('window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;')
  page.goto('http://127.0.0.1:8765')
  page.wait_for_function("Number(document.querySelector('#total-count').textContent)>1000")
  page.locator('#listen-button').click()
  page.wait_for_function('window.__selichotAudioDebug?.stable',timeout=22000)
  debug=page.evaluate('window.__selichotAudioDebug')
  assert debug['microphone']['rms']>0
  assert int(page.locator('#current-count').text_content())>100
  assert not errors,errors
  print(json.dumps({'reference':debug['referenceId'],'current':page.locator('#current-count').text_content(),'rms':debug['microphone']['rms'],'errors':errors}))
  browser.close()
finally:
 wav.unlink(missing_ok=True)
