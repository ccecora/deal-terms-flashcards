"""End-to-end checks: scheduler logic, desktop keyboard flow, mobile touch-swipe flow,
export/import between two 'devices', and screenshots at both sizes."""
import subprocess, time, json, sys, os
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
URL = 'http://localhost:8765/'
fails = []
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

def store(page):
    return page.evaluate("JSON.parse(localStorage.getItem('dealterms.v1') || 'null')")

try:
    with sync_playwright() as p:
        b = p.chromium.launch(**({'executable_path': os.environ['CHROME']} if os.environ.get('CHROME') else {}))

        # ---------- scheduler unit checks ----------
        ctx = b.new_context(viewport={'width': 1280, 'height': 800})
        page = ctx.new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(URL); page.wait_for_selector('.countdown')
        r = page.evaluate("""() => {
          const S = window.SRS, t='2026-11-18', iv='2026-12-02';
          let s = S.rate(null,'good',t,iv); const a = [s.box, s.due];
          s = S.rate(s,'good',t,iv); a.push(s.box, s.due);
          let far = {box:5}; far = S.rate(far,'good','2026-11-28',iv); a.push(far.box, far.due);   // 30d capped to 3d
          let ag = S.rate({box:4,lapses:0},'again',t,iv); a.push(ag.box, ag.due, ag.lapses);
          let ez = S.rate(null,'easy',t,iv); a.push(ez.box, ez.due);
          a.push(S.rate({box:3},'good','2026-12-10',iv).due);  // after interview: uncapped (box 4 = 7d)
          return a; }""")
        check(r[:2] == [1, '2026-11-19'], 'new card + Good -> box 1, due tomorrow')
        check(r[2:4] == [2, '2026-11-20'], 'second Good -> box 2, due in 2 days')
        check(r[4:6] == [6, '2026-12-01'], 'long interval capped to day before interview')
        check(r[6:9] == [1, '2026-11-18', 1], 'Again resets to box 1, due today, lapse counted')
        check(r[9:11] == [2, '2026-11-20'], 'new card + Easy -> box 2')
        check(r[11] == '2026-12-17', 'no cap once interview has passed')
        m = page.evaluate("""() => { const a={items:{x:{box:1,last:5}, y:{box:3,last:9}},reviewLog:{'d1':2}}, b={items:{x:{box:4,last:7}, y:{box:1,last:1}, z:{box:2,last:3}},reviewLog:{'d1':5,'d2':1}};
          const o = SRS.mergeProgress(a,b); return [o.items.x.box,o.items.y.box,o.items.z.box,o.reviewLog.d1,o.reviewLog.d2]; }""")
        check(m == [4, 3, 2, 5, 1], 'merge keeps most recent review per card')
        q = page.evaluate("""() => { const c = [{id:'a',tier:1,topic:'T',exampleMasked:'x'},{id:'b',tier:2,topic:'T'}];
          const st = {tiers:[1,2,3],topics:[],newPerDay:10,modes:{recognize:true,recall:true,example:true}};
          const r1 = SRS.buildQueue(c,{items:{},daily:{date:'',newCount:0}},st,'2026-11-18');
          const r2 = SRS.buildQueue(c,{items:{'a|recognize':{box:2,due:'2026-11-20'}},daily:{date:'',newCount:0}},st,'2026-11-18');
          return [r1.queue.map(i=>i.key), r2.queue.map(i=>i.key)]; }""")
        check(q[0] == ['a|recognize', 'b|recognize'], 'new deck: only term->definition faces until unlocked')
        check(q[1] == ['a|recall', 'a|example', 'b|recognize'], 'recall/example unlock after box 2')

        # ---------- desktop keyboard flow ----------
        page.screenshot(path='/tmp/shot_desktop_home.png', full_page=True)
        page.click('[data-act=start]'); page.wait_for_selector('#card')
        first_term = page.inner_text('.front-term')
        page.screenshot(path='/tmp/shot_desktop_front.png')
        page.keyboard.press('Space'); page.wait_for_selector('.ratings')
        page.screenshot(path='/tmp/shot_desktop_back.png')
        check('→ Good' in page.inner_text('.ratings'), 'rating buttons show arrow hints')
        page.keyboard.press('ArrowRight')
        s = store(page)
        k = [k for k in s['progress']['items']]
        check(len(k) == 1 and s['progress']['items'][k[0]]['box'] == 1, 'ArrowRight = Good saved (box 1)')
        page.keyboard.press('Space'); page.keyboard.press('ArrowLeft')
        s = store(page); again = [v for v in s['progress']['items'].values() if v.get('lapses')]
        check(len(again) == 1, 'ArrowLeft = Again recorded a lapse')
        page.keyboard.press('Space'); page.keyboard.press('ArrowUp')
        page.keyboard.press('Space'); page.keyboard.press('ArrowDown')
        s = store(page); boxes = sorted(v['box'] for v in s['progress']['items'].values())
        check(boxes == [1, 1, 1, 2], 'ArrowUp = Easy (box 2), ArrowDown = Hard (box 1): ' + str(boxes))
        page.keyboard.press('z')
        s = store(page); check(len(s['progress']['items']) == 3, 'Z undoes the last rating')
        check(page.is_visible('.ratings'), 'after undo the answer is showing again')
        page.keyboard.press('Escape'); page.wait_for_selector('.countdown')
        check(True, 'Escape exits to dashboard')
        export_code = store(page)
        # browse + settings render
        page.goto(URL + '#browse'); page.wait_for_selector('.row')
        n_rows = page.locator('.row').count()
        page.fill('#q', 'make-whole'); time.sleep(.2)
        check(n_rows == 106 and page.locator('.row').count() == 1, 'Browse lists 106 terms and search filters')
        page.click('.row > button'); check(page.is_visible('.row .body'), 'Browse row expands')
        page.screenshot(path='/tmp/shot_desktop_browse.png', full_page=True)
        page.goto(URL + '#settings'); page.wait_for_selector('#iv')
        page.click('[data-act=export]'); code = page.input_value('#exportText')
        check(json.loads(code)['app'] == 'deal-terms-flashcards', 'Export produces a code')
        page.screenshot(path='/tmp/shot_desktop_settings.png', full_page=True)
        check(not errors, 'no JS errors on desktop: ' + '; '.join(errors))

        # ---------- mobile: real touch events ----------
        iphone = p.devices['iPhone 13']
        mctx = b.new_context(**iphone)
        m = mctx.new_page(); merr = []
        m.on('pageerror', lambda e: merr.append(str(e)))
        m.goto(URL); m.wait_for_selector('.countdown')
        m.screenshot(path='/tmp/shot_mobile_home.png', full_page=True)
        m.tap('[data-act=start]'); m.wait_for_selector('#card')
        cdp = mctx.new_cdp_session(m)
        def swipe(dx, dy):
            box = m.locator('#card').bounding_box()
            x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
            pt = lambda X, Y: [{'x': X, 'y': Y, 'id': 1}]
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pt(x, y)})
            for i in range(1, 9):
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': pt(x + dx * i / 8, y + dy * i / 8)})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            time.sleep(.15)
        m.tap('#card'); m.wait_for_selector('.ratings')
        check(True, 'tap on card flips it (mobile)')
        m.screenshot(path='/tmp/shot_mobile_back.png')
        swipe(160, 0); s = store(m)
        check(len(s['progress']['items']) == 1 and list(s['progress']['items'].values())[0]['box'] == 1, 'swipe right = Good (mobile)')
        m.tap('#card'); swipe(-160, 0); s = store(m)
        check(any(v.get('lapses') for v in s['progress']['items'].values()), 'swipe left = Again (mobile)')
        m.tap('#card'); swipe(0, -200); m.tap('#card'); swipe(0, 200); s = store(m)
        check(sorted(v['box'] for v in s['progress']['items'].values()) == [1, 1, 1, 2], 'swipe up = Easy, swipe down = Hard (mobile)')
        swipe(160, 0); s = store(m)
        check(len(s['progress']['items']) == 4, 'swipe before flipping does not rate')
        m.tap('[data-act=flip]'); m.tap('[data-act=rate][data-r=good]'); s = store(m)
        check(len(s['progress']['items']) == 5, 'rating buttons work by tap (mobile)')
        # card fits without overflow on a small phone
        for _ in range(6):
            m.tap('#card')
            ov = m.evaluate("() => { const c=document.getElementById('cardContent'); return c.scrollHeight - c.clientHeight; }")
            if ov > 2: fails.append('card overflow %d' % ov); print('FAIL overflow', ov); break
            m.tap('[data-act=rate][data-r=good]')
        else: check(True, 'answers fit inside the card on iPhone 13 screen')
        # import desktop export into mobile -> merged
        m.goto(URL + '#settings'); m.wait_for_selector('#importText')
        m.fill('#importText', code); m.tap('[data-act=import]'); time.sleep(.3)
        s = store(m)
        check(len(s['progress']['items']) >= 5, 'import merges desktop progress into mobile (%d faces)' % len(s['progress']['items']))
        m.goto(URL + '#browse'); m.wait_for_selector('.row'); m.screenshot(path='/tmp/shot_mobile_browse.png')
        m.goto(URL + '#settings'); m.wait_for_selector('#iv'); m.screenshot(path='/tmp/shot_mobile_settings.png', full_page=True)
        # small phone + dark mode
        sctx = b.new_context(**p.devices['iPhone SE'], color_scheme='dark')
        sp = sctx.new_page(); sp.goto(URL); sp.wait_for_selector('.countdown'); sp.tap('[data-act=start]'); sp.wait_for_selector('#card')
        sp.tap('#card'); sp.wait_for_selector('.ratings'); sp.screenshot(path='/tmp/shot_se_dark_back.png')
        dims = sp.evaluate("() => [Math.max(...[...document.querySelectorAll('.rate')].map(e=>e.getBoundingClientRect().bottom)), innerHeight, document.documentElement.scrollHeight]")
        check(dims[0] <= dims[1] and dims[2] <= dims[1] + 1, 'iPhone SE (320x568): rating buttons on screen, no page scroll %s' % dims)
        ov = sp.evaluate("() => { const c=document.getElementById('cardContent'); return c.scrollHeight - c.clientHeight; }")
        check(ov <= 2, 'iPhone SE: answer text fits inside the card')
        check(not merr, 'no JS errors on mobile: ' + '; '.join(merr))
        b.close()
finally:
    srv.terminate()
print('\n%d failure(s)' % len(fails))
