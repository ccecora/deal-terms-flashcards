"""Build data/cards.json from the study guide's extracted terms.

Adds: ids, topics, tiers, extra cards for terms that only appear in tables,
scenario examples for the example->term mode, and masked text so the
recall modes never show the answer.
"""
import json, re

raw = json.load(open('raw_cards.json'))

TOPIC = {1: 'Fundamentals', 2: 'Bonds', 3: 'Bonds', 4: 'Bonds', 5: 'Covenants', 6: 'Loans',
         7: 'Liability management', 8: 'M&A', 9: 'EDGAR', 10: 'Data platform'}

EXTRA = [  # terms that appear only inside tables in the guide
    ('Limitation on indebtedness', 5, 'Core high-yield covenant restricting how much additional debt the company can take on, outside permitted baskets and ratio debt. More debt means a smaller share of the company for existing lenders.', None),
    ('Restricted payments', 5, 'Core high-yield covenant restricting dividends, stock buybacks and certain investments: cash leaving for shareholders instead of repaying lenders.', None),
    ('Limitation on liens', 5, 'Core high-yield covenant restricting pledging assets as collateral to other lenders, so other creditors can\'t jump ahead in line.', None),
    ('Asset sales covenant', 5, 'Core high-yield covenant restricting asset sales: sale proceeds must be reinvested in the business or used to repay debt within a set period.', None),
    ('Affiliate transactions covenant', 5, 'Core high-yield covenant requiring deals with insiders or related companies to be on arm\'s-length terms, so value can\'t be siphoned out.', None),
    ('8-K', 9, 'Current report filed within days of a material event. New indentures, credit agreements and merger agreements are attached to it as exhibits.', None),
    ('10-K', 9, 'Annual report with audited financial statements. Material contracts are often re-filed as exhibits.', None),
    ('10-Q', 9, 'Quarterly report. Contracts signed during the quarter are often filed as exhibits.', None),
    ('S-1', 9, 'Registration statement for a new public offering of securities, such as an IPO.', None),
    ('424B (e.g. 424B2, 424B5)', 9, 'Final prospectus or prospectus supplement for a registered offering; describes the terms of registered bond deals.', None),
]

EXAMPLES = {
    'Equity': 'A startup sells 20% of its shares to a venture fund for $10M.',
    'Debt': 'A company borrows $300M, promising 6% a year and repayment in 2030; lenders get nothing extra if profits soar.',
    'M&A (mergers and acquisitions)': 'Company A agrees to buy Company B for $4B in cash.',
    '"What\'s market?"': 'A lawyer asks: "Across 2025 high-yield deals, what share used a 101% change-of-control price?"',
    'Principal (face amount, aggregate principal amount)': 'The "$500,000,000" in "Acme $500,000,000 7.50% Senior Notes due 2031."',
    'Par': 'A bond quoted at a price of 100 trades at exactly its face value.',
    'Coupon (interest rate)': 'The "7.50%" in "Acme 7.50% Senior Notes due 2031," paid semi-annually.',
    'Maturity (maturity date)': 'The "2031" in "Acme 7.50% Senior Notes due 2031."',
    'Basis point (bp, bps)': 'A loan priced at "SOFR + 275" pays 2.75 percentage points over SOFR.',
    'Indenture': 'A 140-page contract filed as Exhibit 4.1 that sets the notes\' payment terms, covenants and defaults.',
    'Issuer': 'Acme Corp: the company that sells the notes and owes the interest.',
    'Trustee': 'U.S. Bank, named in the bond contract to enforce it on behalf of all holders.',
    'Senior vs subordinated': 'In bankruptcy, one class of noteholders is paid in full before a junior class receives anything.',
    'Secured vs unsecured': 'One tranche of lenders can seize the company\'s factories if it defaults; another tranche has no pledged assets.',
    'Credit rating': 'S&P grades the company BB+ and Moody\'s grades it Ba1.',
    'Investment grade vs high yield': 'A BBB- company pays 5% with few covenants; a B-rated company pays 9% with a 100-page covenant package.',
    'Rule 144A / Regulation S': 'Notes sold only to large US institutions and to buyers outside the US, without a full SEC registration.',
    'Optional redemption (call)': 'Rates fall, so Acme repays its 7.5% notes early at 103.75% and refinances at 5%.',
    'Non-call period': '"NC3": for the first three years the notes can\'t be repaid early at normal prices.',
    'Make-whole': 'In year 1, repaying the notes early costs the present value of every remaining coupon, discounted at Treasuries + 50bps.',
    'Equity clawback': 'After its IPO, Acme uses the cash to redeem 35% of its 7.50% notes at 107.50%.',
    'Change of control': 'A private equity firm buys 60% of Acme\'s voting stock.',
    'Change of control put': 'Acme is acquired, and holders force it to buy back their notes at 101.',
    'Double trigger': 'Holders can sell their bonds back only if Acme is acquired AND its credit rating is cut.',
    'EBITDA': 'Revenue of $1B minus $750M of operating costs = $250M, before interest, taxes and non-cash charges.',
    'Leverage ratio': '$1B of debt against $250M of EBITDA = 4.0x.',
    'Interest coverage ratio': '$250M of EBITDA against $80M of interest expense = 3.1x.',
    'Incurrence covenant': 'Acme\'s leverage drifts up to 6x, but nothing is tested until it tries to borrow more or pay a dividend.',
    'Grower basket': 'Permitted: "the greater of $50M and 10% of EBITDA," so $60M once EBITDA reaches $600M.',
    'Builder basket': 'Acme has earned $200M since closing, so it may now pay $100M in dividends.',
    'EBITDA add-backs': 'Acme counts $40M of "expected synergies" on top of $250M of earnings, so its covenant tests use $290M.',
    'Covenant-lite': 'A $2B term loan with no quarterly leverage test at all.',
    'Restricted vs unrestricted subsidiaries': 'Acme designates its software arm as outside the covenants, so assets there are beyond lenders\' reach.',
    'Credit agreement': 'A contract filed as Exhibit 10.1 between Acme, JPMorgan as agent, and 30 lenders.',
    'Lenders and syndicate': 'A $1.5B loan split among 40 banks and funds.',
    'Administrative agent': 'JPMorgan collects Acme\'s loan payments and passes them on to the 40 lenders.',
    'Guarantors': 'Acme\'s 12 operating subsidiaries promise to repay the loan if Acme can\'t.',
    'Revolver (revolving credit facility)': 'Acme draws $50M in March to pay suppliers, repays it in May, and draws again in August.',
    'Term Loan A (TLA)': 'A 5-year bank loan repaid in equal quarterly installments.',
    'Term Loan B (TLB)': 'A 7-year loan sold to CLO funds, repaying 1% a year with the rest due at maturity.',
    'Financial covenants': 'Acme must keep leverage under 4.5x and interest coverage above 2.0x every quarter.',
    'Events of default': 'Acme misses an interest payment, and lenders can demand all principal immediately.',
    'Cross-default': 'Acme defaults on a $100M bond, which automatically puts its bank loan in default too.',
    'MFN (most favored nation)': 'Acme adds a new loan at SOFR + 400; existing lenders at SOFR + 300 get bumped to SOFR + 350.',
    'Liability management exercise (LME)': 'A struggling retailer swaps some lenders into new, more senior debt while others are left behind.',
    'Blocker': 'Contract language added after a loophole was exploited, usually named after the company that exploited it.',
    'J.Crew blocker': 'A clause barring the transfer of material IP to subsidiaries outside the covenants.',
    'Serta blocker': 'A clause requiring every affected lender\'s consent before changing the order of repayment.',
    'Chewy blocker': 'A clause saying a subsidiary\'s guarantee isn\'t released just because it stops being wholly owned.',
    'Merger agreement': 'An 8-K Exhibit 2.1 contract under which Buyer acquires Target for $45 per share.',
    'Reps and warranties': '"The Company\'s financial statements fairly present its financial position in all material respects."',
    'Closing conditions': 'The deal can\'t complete until antitrust approval arrives and shareholders vote yes.',
    'MAE / MAC (material adverse effect / change)': 'Target\'s sales collapse 60% after a product recall, and Buyer tries to walk away.',
    'Termination fee (break fee)': 'Target accepts a higher bid and pays the original buyer $120M on a $4B deal.',
    'Reverse termination fee': 'Regulators block the deal, so Buyer pays Target $300M.',
    'Outside date': 'If the deal hasn\'t closed by June 30, 2027, either party can terminate.',
    'No-shop': 'After signing, Target may not solicit or negotiate with other bidders.',
    'Go-shop': 'Target has 40 days after signing to actively seek higher bids.',
    'Fiduciary out': 'Despite the deal restrictions, Target\'s board accepts an unsolicited superior offer.',
    'EDGAR': 'The sec.gov database holding every public company filing since the mid-1990s.',
    '8-K items': 'A filing that lists "Item 2.03 Creation of a Direct Financial Obligation" and "Item 9.01."',
    'Exhibit numbering': 'An indenture filed as 4.1, a credit agreement as 10.1, and a merger agreement as 2.1.',
    'Full-index files': 'sec.gov/Archives/edgar/full-index/2025/QTR1/form.idx',
    'Submissions JSON': 'data.sec.gov/submissions/CIK0000320193.json',
    'Full-text search': 'Finding every filing since 2001 containing both "change of control" and "indenture."',
    'Filing index page': 'The landing page for one filing that lists EX-4.1, EX-10.1 and the main document.',
    'Bulk data': 'A nightly multi-gigabyte zip containing every company\'s reported financial facts.',
    'XBRL and company facts': 'Machine-readable tagged values like us-gaap:Revenues for every reported period.',
    'Fair access policy': 'Your scraper gets 403 errors because it sends no identifying header and makes 50 requests a second.',
    'Idempotency': 'Re-running the loader after a crash leaves exactly one row per filing, not two.',
    'Resumability': 'A download job killed at file 4,000 restarts at file 4,001.',
    'Backfill vs incremental load': 'Loading 10 years of filings once, then only each new day\'s filings after that.',
    'Provenance / lineage': 'Every extracted coupon links back to its filing URL and section number.',
    'Schema drift': 'A data provider renames a column between monthly files and the load silently produces nulls.',
    'Deduplication': 'The same indenture appears in an 8-K and again in the 10-K; keep just one record.',
    'Data-quality rules': 'Reject rows with a negative principal or a maturity before the issue date, and report how many failed.',
    'Audit trail': 'A log showing that analyst J. Smith edited record 1042 at 3:14pm.',
    'Right to erasure (GDPR)': 'A user in France demands that all of their personal data be deleted.',
    'PII': 'Names, email addresses and passport numbers found in uploaded documents.',
    'Chunking': 'Splitting a 140-page indenture into one piece per section heading.',
    'Embeddings': '"Buy back the notes" and "repurchase the securities" map to nearby vectors.',
    'Keyword search (BM25, full-text)': 'A query for "make-whole" ranks only sections containing that exact word, weighting rare words higher.',
    'Semantic search': 'A query for "company must repurchase notes if acquired" finds the right section with no shared words.',
    'Hybrid search': 'Combining word-match scores and vector-similarity scores with reciprocal rank fusion.',
    'Golden set': '50 indentures where you hand-labeled the correct coupon and change-of-control price.',
    'Limitation on indebtedness': 'Acme can\'t take on new debt beyond its permitted baskets.',
    'Restricted payments': 'Acme wants to pay a $200M special dividend to its private equity owner.',
    'Limitation on liens': 'Acme can\'t pledge its factories as collateral to a new lender.',
    'Asset sales covenant': 'Acme sells a division for $500M and must reinvest the cash or repay debt within a year.',
    'Affiliate transactions covenant': 'Acme buys services from a company owned by its CEO, so the terms must be arm\'s-length.',
    '8-K': 'Filed within four business days after Acme signs a new credit agreement.',
    '10-K': 'Acme\'s annual report with audited financial statements.',
    '10-Q': 'Acme\'s report for the quarter ended September 30.',
    'S-1': 'Filed with the SEC before Acme\'s IPO.',
    '424B (e.g. 424B2, 424B5)': 'The final prospectus supplement for a registered bond offering.',
}

TIER1 = {'Equity', 'Debt', 'Notes vs bonds', 'M&A (mergers and acquisitions)', '"What\'s market?"',
         'Principal (face amount, aggregate principal amount)', 'Par', 'Coupon (interest rate)', 'Maturity (maturity date)',
         'Basis point (bp, bps)', 'Indenture', 'Issuer', 'Trustee', 'Senior vs subordinated', 'Secured vs unsecured',
         'Investment grade vs high yield', 'Optional redemption (call)', 'Non-call period', 'Step-down call schedule',
         'Make-whole', 'Equity clawback', 'Change of control', 'Change of control put', 'Credit agreement', 'Merger agreement',
         'Termination fee (break fee)', 'EDGAR', 'CIK (Central Index Key)', 'Accession number', '8-K', 'Exhibit numbering',
         'Filing index page', 'Full-index files', 'Submissions JSON', 'Fair access policy', 'Idempotency', 'Resumability',
         'Provenance / lineage', 'Golden set', 'Precision and recall', 'Chunking'}
TIER2 = {'Credit rating', 'Rule 144A / Regulation S', 'EBITDA', 'Leverage ratio', 'Interest coverage ratio',
         'Maintenance covenant', 'Incurrence covenant', 'Basket', 'Ratio debt', 'Limitation on indebtedness',
         'Restricted payments', 'Limitation on liens', 'Asset sales covenant', 'Affiliate transactions covenant',
         'Borrower', 'Lenders and syndicate', 'Administrative agent', 'Revolver (revolving credit facility)',
         'Term Loan A (TLA)', 'Term Loan B (TLB)', 'SOFR + margin', 'Financial covenants', 'Events of default',
         'MAE / MAC (material adverse effect / change)', 'Reverse termination fee', 'Outside date', 'No-shop', 'Go-shop',
         '8-K items', 'Full-text search', 'Bulk data', 'XBRL and company facts', 'Backfill vs incremental load',
         'Schema drift', 'Deduplication', 'Data-quality rules', 'Embeddings', 'Keyword search (BM25, full-text)',
         'Semantic search', 'Hybrid search'}


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def phrases(term, aliases):
    out = set()
    for p in [term] + list(aliases):
        p = p.strip('"?')
        out.add(p)
        base = re.sub(r'\s*\(.*?\)', '', p).strip()
        out.add(base)
        for inner in re.findall(r'\((.*?)\)', p):
            for part in inner.split(','):
                part = re.sub(r'^e\.g\.\s*', '', part.strip())
                if part: out.add(part)
        for sep in [' vs ', ' / ', ' and ']:
            if sep in base:
                for part in base.split(sep): out.add(part.strip())
    out = {p for p in out if len(p) >= 2}
    # plural / possessive forms
    return sorted(out, key=len, reverse=True)


def mask(text, ph):
    if not text: return text
    for p in ph:
        text = re.sub(r'(?<![A-Za-z0-9])' + re.escape(p) + r'(?:s|es|\'s)?(?![A-Za-z0-9])', '_____', text, flags=re.I)
    return text


cards, seen = [], set()
all_raw = [dict(r, section_num=int(r['section'].split('.')[0])) for r in raw]
for term, sec, d, ex in EXTRA:
    all_raw.append({'term': term, 'def': d, 'ex': ex, 'why': None, 'aliases': [term], 'section_num': sec})

for r in all_raw:
    term = r['term'].strip()
    display = term.strip('"')
    cid = slug(display)
    assert cid not in seen, cid
    seen.add(cid)
    ex = EXAMPLES.get(term) or r.get('ex')
    tier = 1 if term in TIER1 else 2 if term in TIER2 else 3
    ph = phrases(term, r.get('aliases') or [])
    c = {
        'id': cid, 'term': display, 'definition': r['def'], 'example': ex, 'why': r.get('why'),
        'topic': TOPIC[r['section_num']], 'tier': tier, 'section': r['section_num'],
        'definitionMasked': mask(r['def'], ph), 'exampleMasked': mask(ex, ph) if ex else None,
    }
    cards.append({k: v for k, v in c.items() if v is not None})

unused = set(EXAMPLES) - {r['term'] for r in all_raw}
assert not unused, unused
for t in TIER1 | TIER2:
    assert t in {r['term'] for r in all_raw}, t

order = ['Fundamentals', 'Bonds', 'Covenants', 'Loans', 'Liability management', 'M&A', 'EDGAR', 'Data platform']
cards.sort(key=lambda c: (c['tier'], order.index(c['topic'])))
json.dump({'version': 1, 'interviewDate': '2026-12-02', 'cards': cards}, open('../data/cards.json', 'w'), indent=1, ensure_ascii=False)

from collections import Counter
print(len(cards), 'cards;', sum('example' in c for c in cards), 'with examples')
print('tiers', Counter(c['tier'] for c in cards))
# leak check: does the masked text still contain the answer's main words?
for c in cards:
    for f in ('definitionMasked', 'exampleMasked'):
        t = c.get(f)
        if t and re.search(re.escape(re.sub(r'\s*\(.*?\)', '', c['term'])), t, re.I):
            print('LEAK', c['id'], f)
