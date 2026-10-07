<!--
  RETITC — §235-12.5 Renewable Energy Technologies Income Tax Credit.
  A 4-page analysis, pared down from the standalone PDF at
  ~/Census-Forecaster/generate_reec_report.py (CD1 formula).

  Every slot below is editable in the draft editor. The CHARTS are drawn in
  render_report.py from the DATA constants at the top of that file — a figure
  changed here and not there will disagree with the chart. Change numbers in
  BOTH places, or better, re-run the model and update the constants:

      cd ~/Census-Forecaster && .venv/bin/python generate_reec_report.py --cd 1

  Model: tax_modeler.scenarios.sb3125_cd1_credits.compute_credit_overlay,
  vintage-pool carryforward, OBBBA Mid scenario, TY2027–2031.
  Methodology: ~/Census-Forecaster/RETITC_REPORT_METHODOLOGY.md
  Act 24 / EO 26-02 writeup: ~/Census-Forecaster/SB3125_CD1_FORECAST.md

  WRITTEN FOR A READER WHO DOES NOT DO THIS FOR A LIVING. Terms of art are
  glossed where they first appear — nonrefundable, the pro-rata cut, unused
  credits carried forward — because the glossary page is gone. If you add a
  term, gloss it in the same sentence rather than assuming it.

  NO RECOMMENDATIONS. This is an analysis; it describes and does not advise.
  Removed 2026-08-21 at the user's direction — the five that were here are in
  git history at ed13dfe if they are ever wanted back.
-->

[[title]]
Renewable Energy Technologies Tax Credit — Act 24 and the one-year reprieve

[[cover.pill]]
§235-12.5

[[cover.h1]]
Renewable Energy Technologies Tax Credit

[[cover.deck]]
What Act 24 does to Hawaiʻi's solar tax credit, and what the governor gave back for a year.

[[cover.figures.h]]
KEY FIGURES

[[cover.fig.a.n]]
$100M

[[cover.fig.a.l]]
CLAIMED IN TAX YEAR 2023

[[cover.fig.b.n]]
$40M

[[cover.fig.b.l]]
THE NEW ANNUAL CAP · 2027–2030

[[cover.fig.c.n]]
2029

[[cover.fig.c.l]]
LAST YEAR FOR NEW CREDITS

[[cover.contents.h]]
INSIDE THIS REPORT

[[cover.contents.02]]
What Act 24 does to a $100M tax break

[[cover.contents.03]]
Who claims it, and who pays for the cap

[[cover.contents.04]]
Impact of capping the credit

[[cover.source]]
Source: Hawaiʻi Department of Taxation — Tax Credits Claimed by Hawaiʻi Taxpayers (December 2025).

[[cover.stamp]]
Hawaiʻi Appleseed Center for Law & Economic Justice  ·  Act 24, SLH 2026  ·  Projections use the CD1 credit formula.

[[about.eyebrow]]
The credit

[[about.h1]]
What Act 24 does to the RETITC

[[about.sub]]
§235-12.5 · Hawaiʻi Revised Statutes

[[about.works.p1]]
If you install renewable energy equipment in Hawaiʻi — usually rooftop solar — the RETITC reduces your state income tax. It is the State's biggest tax break for renewable energy, and one of the forces behind its target of 100 percent renewable electricity by 2045.[^dotax]

[[hist.note]]
Claims average **$86.1M** over six years. Tax Year 2020's spike was trusts, estates and financial corporations — $2.7M to $50.9M and back. Household claims are steadier, rising every year in nominal dollars.

[[about.change.h]]
What changes under Act 24

[[about.change.p]]
SB 3125 was signed **May 21, 2026** and is now **Act 24**.[^act24] Washington ended the federal residential solar credit at the end of 2025, so the State credit is now the only one a household can claim.

[[about.card.a.n]]
$40M

[[about.card.a.l]]
ANNUAL CAP

[[about.card.a.d]]
Tax Year 2027–2030. If approved credits top $40M, every credit is cut by the same percentage.

[[about.card.b.n]]
$175K

[[about.card.b.l]]
INCOME LIMIT

[[about.card.b.d]]
Filers above $175K, or $350K for a married couple, no longer qualify. Starts 2027, not 2026.

[[about.card.c.n]]
2029

[[about.card.c.l]]
FINAL YEAR

[[about.card.c.d]]
No new credits after Tax Year 2029. Credits already earned can still be claimed.

[[about.foot]]
Source: DOTAX, Tax Credits Claimed by Hawaiʻi Taxpayers — 2018–2022 actuals, Tax Year 2023 published December 2025.[^dotax] "Other" is total minus individual and corporate, picking up figures withheld for privacy. Approvals run through the Hawaiʻi State Energy Office.

[[eo.h]]
The governor's one-year reprieve

[[eo.p]]
The cap reaches back to Tax Year 2026, over systems already paid for and permitted. Three weeks after signing the bill, Gov. Josh Green signed an executive order protecting a large portion of that year's projects, citing **"a risk of litigation."**[^eo] It lifts the cap and nothing else, covering systems finished — or already paid for — before **May 21, 2026**.[^tir] Nobody has priced it: the State has published no figure, and our own estimate puts about **$85M** beyond the cap's reach, once, in 2027 and 2028.[^cb]

[[pays.eyebrow]]
Who pays

[[pays.h1]]
Who claims the credit, and who pays for the cap

[[pays.sub]]
Tax Year 2023 claims · Tax Year 2027 burden

[[pays.agi.h]]
Who claims it today

[[pays.agi.note]]
Households above $200K take **45 percent** of individual claims; everyone under $60K takes less than a fifth. Solar costs about $30,000 up front, and the credit is **nonrefundable** — it only cancels tax you already owe, so a filer whose bill is smaller than the credit never sees the difference. Act 24's income limit goes at the top: the orange marks show where it bites, the top two brackets only.

[[pays.foot]]
Source: DOTAX Table A-5, Tax Year 2023 individual claims by bracket.[^dotax] Adjusted gross income is roughly earnings before deductions. Individuals claimed $58.3M of the program's $100.1M; businesses and trusts the rest.

[[saves.eyebrow]]
What it saves

[[saves.h1]]
Impact of capping the credit

[[saves.sub]]
Projected against a no-bill baseline  ·  Tax Year 2027–2031

[[saves.chart.note]]
Act 24 may reduce credit claims by **$385M** over five years. More than half of it — $204M — lands in 2030 and 2031, after the credit stops issuing entirely. Those two years show the largest savings because the credit itself is nearly phased out by then, not because the cap bites harder. In 2031 the credit may cost the State about **$2M**, against $107M had the law not passed.

[[pays.burden.h]]
Who pays more in Tax Year 2027

[[pays.burden.note]]
**The cap makes no distinction.** Once a year's claims pass $40M, every remaining credit is cut by the same share — roughly 56 percent at 2027 demand — so a household in the bottom fifth would pay about $40 more. The income limit only touches the top. Businesses and trusts hold about 42 percent of the credit and fall outside it entirely: a commercial system has no personal income to test.

[[saves.stat.a.n]]
$385M

[[saves.stat.a.l]]
revenue the State keeps, 2027–2031; range $372M–$434M

[[saves.stat.b.n]]
53%

[[saves.stat.b.l]]
of that comes in 2030–31, after new credits stop

[[saves.stat.c.n]]
$103M

[[saves.stat.c.l]]
what the credit still costs in 2027, with a $40M cap

[[saves.foot]]
**Why $103M and not $40M:** the cap limits only new credits; unused credits from earlier years keep being claimed on top.[^model] How fast that older pile drains is the model's shakiest input — it assumes 65 percent a year, a rate the State does not publish and nobody has measured here. The totals above barely move if it is wrong, but the pile itself swings threefold, which is why no figure for it appears. Also: the projections assume the cap hits Tax Year 2026 systems, which the order mostly prevents, so savings are **somewhat overstated**; household figures round to the nearest $10; no behavioral change is modeled.[^method] Two loose ends outside the model: the Council on Revenues had not accounted for Act 24 or the executive order in its last forecast,[^cor] and the law names two end dates — 2029 in one subsection, 2031 in another — which the Tax Department settled at 2030 by announcement.[^ann]

[[foot.running]]
RETITC · §235-12.5

[[endnotes.h2]]
Sources

[[sources]]
[dotax]: Hawaiʻi Dept. of Taxation, Tax Credits Claimed by Hawaiʻi Taxpayers, Tax Year 2023 (December 2025). — https://tax.hawaii.gov/stats/a5_1annual/a5_4credits/
[act24]: Act 24, Session Laws of Hawaiʻi 2026 (SB 3125), signed May 21, 2026. — https://www.capitol.hawaii.gov/session/measure_indiv.aspx?billtype=SB&billnumber=3125&year=2026
[eo]: Executive Order No. 26-02, Office of the Governor, June 8, 2026. — https://governor.hawaii.gov/executive-orders/
[tir]: Hawaiʻi Dept. of Taxation, Tax Information Release No. 2026-02, July 31, 2026. — https://tax.hawaii.gov/legal/tir/
[cb]: Hawaiʻi Solar Energy Association figures reported by Honolulu Civil Beat, May 29 and June 12, 2026. — https://www.civilbeat.org/
[cor]: Hawaiʻi Council on Revenues, General Fund forecast of May 21, 2026. — https://tax.hawaii.gov/useful/a2_b2_5cor/
[ann]: Hawaiʻi Dept. of Taxation, Announcement No. 2026-06. — https://tax.hawaii.gov/legal/announce/
[model]: Census-Forecaster credit-overlay model (CD1 formula). — https://github.com/Hawaii-Appleseed/Census-Forecaster/blob/main/generate_reec_report.py
[method]: Census-Forecaster, "RETITC Report — How the Pipeline Works." — https://github.com/Hawaii-Appleseed/Census-Forecaster/blob/main/RETITC_REPORT_METHODOLOGY.md
