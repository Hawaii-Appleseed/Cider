<!--
  Rx Kids Hawaiʻi — fiscal one-pager. Every slot below is editable in the
  draft editor; the charts are drawn in render_report.py from the DATA
  constants at the top of that file, so a figure changed here and not there
  will disagree with the chart. Change numbers in BOTH places, or better,
  re-run the model and update the constants first.

  Model: ~/Census-Forecaster/forecast_rxkids_2028.py (TY2028, universal
  eligibility, take-up 0.90 newborn / 0.83 prenatal).
-->

[[title]]
Rx Kids Hawaiʻi — what it costs and who can pay

[[hero.eyebrow]]
HAWAIʻI APPLESEED · FISCAL ESTIMATE · 2028

[[hero.h1]]
Rx Keiki: the cost, and the funding wall

[[hero.standfirst]]
A universal program: **$1,500 during pregnancy**, then **$500 a month after birth**, for every family — no income test, no work requirement.

[[stat.a.n]]
13,228

[[stat.a.l]]
births a year — no income test

[[stat.b.n]]
$52.1M

[[stat.b.l]]
core program: 6 months only

[[stat.c.n]]
$87.9M

[[stat.c.l]]
full program, 12 months total

[[stat.d.n]]
40%

[[stat.d.l]]
of the core program covered by federal TANF dollars

[[timeline.title]]
Federal money runs out after the fourth payment — by rule, not by budget

[[timeline.note]]
Numbered bars are months after birth.

[[funding.title]]
What TANF covers — and what Hawaiʻi must raise

[[funding.note]]
**Choosing the screen is worth ~$19.2M a year**.[^son]

[[medicaid.title]]
Six in ten births are already on Medicaid — four in ten are not

[[medicaid.note]]
Only the left-hand pool is reachable with federal dollars.

[[risk.h]]
The federal exposure is real, and untested

[[risk.points]]
- **Monthly cash is federally "assistance"** — it triggers work requirements and the 60-month clock. Michigan's fix: a **non-recurrent short-term benefit**, exempt but capped at four payments.[^nrst]
- **No federal agency has ruled on it** — no approval, no waiver, no audit finding; Michigan's position sits unadjudicated.[^rxkids]

[[ask.h]]
Where the non-federal share comes from

[[ask.points]]
- **A $459M idle TANF reserve** — 4.7 years of Hawaiʻi's block grant — makes the $20.7M federal slice the easy part.[^reserve]
- That leaves **$31.5M a year** to raise for the core program, or **$67.2M** through twelve months.
- Phase months 7–12 as contingent, so the ask grows with the fundraising.

[[footer.note]]
**Method.** Census PUMS microdata (ACS 2018–2022) aged to 2028; births anchored to CDC and Hawaiʻi DOH counts,[^births] and eligibility tested per family on projected 2028 income.[^model] **Uncertainty.** Costs exclude administration (add ~8%); take-up assumed 0.90 newborn / 0.83 prenatal. With no Hawaiʻi program to calibrate against, true uncertainty is roughly ±30–40%.

[[endnotes.h2]]
Sources

<!-- Chart labels, drawn in place (svg_text). Words, not data: retyping one
     changes the label and nothing else — the bars come from the DATA
     constants in render_report.py. -->

[[chart.timeline.legend.fed]]
Federal TANF can cover

[[chart.timeline.legend.nonfed]]
State / county / philanthropy

[[chart.timeline.legend.contingent]]
…contingent on available funds

[[chart.timeline.prenatal]]
$1,500

[[chart.timeline.monthly]]
$500 per month

[[chart.timeline.axis.prenatal]]
Pregnancy

[[chart.timeline.band.fed]]
4 payments · $3,000 max

[[chart.timeline.band.rest]]
every remaining payment

[[chart.funding.legend.fed]]
Federal TANF

[[chart.funding.legend.nonfed]]
State / county / philanthropy

[[chart.funding.scale]]
all bars share one scale

[[chart.funding.s1.title]]
Medicaid enrollment — Michigan's actual approach

[[chart.funding.s1.core.label]]
Core · through 6 mo

[[chart.funding.s1.core.fed]]
$20.7M

[[chart.funding.s1.core.rest]]
$31.5M to raise

[[chart.funding.s1.full.label]]
Full · through 12 mo

[[chart.funding.s1.full.fed]]
$20.7M

[[chart.funding.s1.full.rest]]
$67.2M to raise

[[chart.funding.s2.title]]
Hawaiʻi's current TANF test (net income, ~30% FPL)

[[chart.funding.s2.core.label]]
Core · through 6 mo

[[chart.funding.s2.core.fed]]
$1.4M

[[chart.funding.s2.core.rest]]
$50.7M to raise

[[chart.funding.s2.full.label]]
Full · through 12 mo

[[chart.funding.s2.full.fed]]
$1.4M

[[chart.funding.s2.full.rest]]
$86.4M to raise

[[chart.medicaid.caption]]
13,228 births served each year

[[chart.medicaid.left]]
7,969 on Medicaid  ·  60%

[[chart.medicaid.right]]
5,259  ·  40%

[[sources]]
[model]: Rx Kids Hawaiʻi cost model, TY2028 universal scenario — Medicaid split computed per family, not a national average. — https://github.com/dtomkatsu/Census-Forecaster/blob/main/forecast_rxkids_2028.py
[births]: Census-Forecaster methodology — births anchored to CDC NVSR and Hawaiʻi DOH. — https://github.com/dtomkatsu/Census-Forecaster/blob/main/RXKIDS_METHODOLOGY.md
[nrst]: 45 CFR 260.31 and ACF Program Instruction TANF-ACF-PI-2008-05, "Diversion Programs." — https://acf.gov/ofa/policy-guidance/tanf-acf-pi-2008-05-diversion-programs-amended
[rxkids]: Michigan PA 119 of 2023, Sec. 2006; Hanna & Shaefer, "Playbook for Replicating Rx Kids," MSU Poverty Solutions, 2024. — https://rxkids.org/wp-content/uploads/2024/08/Rx_Kids_TANF_Playbook.pdf
[son]: Hawaiʻi Administrative Rules §17-678-4 and §17-676-54.1. — https://humanservices.hawaii.gov/wp-content/uploads/2025/02/17-678_Financial-Assistance-Standards-Adopted-01-26-25.pdf
[reserve]: Hawaiʻi DHS, TANF report to the 2025 Legislature (HRS §346-51.5), March 2025. — https://humanservices.hawaii.gov/wp-content/uploads/2024/11/RYamane_2025-HRS-Sect-346-51.5-TANF-Legislative-Report-DHS-BESSD-signed.pdf

<!-- =========================================================
     Page 2 — Program overview: how it works
     ========================================================= -->

[[p2.hero.eyebrow]]
HAWAIʻI APPLESEED · PROGRAM OVERVIEW · 2026

[[p2.hero.h1]]
Rx Keiki: how it works

[[p2.hero.standfirst]]
A cash prescription for every new baby — delivered like a public health checkup, not a benefits application.

[[p2.stat.a.n]]
0

[[p2.stat.a.l]]
income tests, work rules, or asset limits

[[p2.stat.b.n]]
12

[[p2.stat.b.l]]
months of payments, birth to first birthday

[[p2.stat.c.n]]
100%

[[p2.stat.c.l]]
of families with a new baby qualify

[[p2.stat.d.n]]
1

[[p2.stat.d.l]]
simple sign-up, no separate applications later

[[p2.evidence.title]]
What the evidence shows

[[p2.ev.a]]
Fewer ER visits for child maltreatment

[[p2.ev.b]]
Better food & financial security

[[p2.ev.c]]
Fewer families separated by need

[[p2.ev.d]]
Stronger parental mental health

[[p2.evidence.note]]
Based on outcomes tied to unconditional cash support during pregnancy and a child's first year, including the 2021 expanded Child Tax Credit.

[[p2.why.title]]
Why Hawaiʻi

[[p2.why.a.h]]
2nd-highest cost of living in the U.S.

[[p2.why.a.b]]
Wages haven't kept pace with the price of raising a child here

[[p2.why.b.h]]
Multigenerational households

[[p2.why.b.b]]
Cash supports the whole ʻohana caring for a keiki, not just one parent

[[p2.why.c.h]]
Neighbor-island access

[[p2.why.c.b]]
Cash covers travel to prenatal and pediatric care that other benefits can't

[[p2.benefits.title]]
Keeps what families already have

[[p2.benefits.items]]
- Medicaid
- SNAP
- WIC
- Housing assistance
- SSI (talk to caseworker)

[[p2.quote.text]]
"Rx Kids provides a real chance at a future for me and my children."

[[p2.quote.attr]]
Teagan, Rx Kids Mom (Flint, MI)

[[p2.how.title]]
How it works

[[p2.how.note]]
No re-enrollment, no monthly paperwork — family decides how every dollar is spent.

[[p2.footer.note]]
Rx Keiki is a proposed program of Hawaiʻi Appleseed, modeled on Rx Kids (Michigan State University Pediatric Public Health Initiative & University of Michigan Poverty Solutions)

[[p2.sources.note]]
Sources: Hanna & Shaefer, "Playbook for Replicating Rx Kids," MSU Poverty Solutions, 2024 · Rx Kids program data, City of Flint, MI · Stanczyk (2016), Washington Center for Equitable Growth · Hawaiʻi DBEDT cost-of-living reporting

[[chart.how.s1.label]]
Sign up

[[chart.how.s1.desc]]
during pregnancy

[[chart.how.s2.label]]
$1,500

[[chart.how.s2.desc]]
prenatal payment

[[chart.how.s3.label]]
Baby arrives

[[chart.how.s3.desc]]
deposits start

[[chart.how.s4.label]]
$500/month

[[chart.how.s4.desc]]
no re-enrollment

[[chart.how.s5.label]]
1st birthday

[[chart.how.s5.desc]]
family chooses
