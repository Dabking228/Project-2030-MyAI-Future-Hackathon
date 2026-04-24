# SYBAR_AI Carbon Emission Methodology

This document describes the carbon emission factors used by the SYBAR_AI
route optimization system when calculating and comparing CO₂ emissions.

---

## Emission Factors (grams CO₂ per passenger-kilometre)

| Mode | Factor | Source |
|------|--------|--------|
| Rail (LRT / MRT / KTM electric) | 14 g/km | IEA, MyCC Malaysia benchmarks |
| Diesel bus (stage bus) | 68 g/km | SPAD Malaysia average, UITP |
| Walking / cycling | 0 g/km | Zero direct emissions |
| Private petrol car (baseline) | 192 g/km | MyCC Malaysia 2023, DOE |

## Explanation

### Rail (14 g/km)
Malaysia's LRT and MRT lines run on electric traction.
The emission factor accounts for the carbon intensity of Malaysia's electricity
grid (which uses a mix of gas, coal, and renewables) divided by average
passenger occupancy on urban rail (~150 passengers per car, 4-6 cars).
KTMB (KTM Komuter) uses electric multiple units on the Klang Valley network,
so the same factor applies.

### Diesel bus (68 g/km)
Stage buses operated by Prasarana and BAS.MY operators run on diesel.
The 68 g/km factor assumes average occupancy of ~30 passengers on a
full-sized bus emitting ~2,040 g CO₂/km total.
Express or long-haul buses may vary; this factor applies to urban stage buses.

### Private car baseline (192 g/km)
A typical Malaysian petrol sedan (1.5–2.0L engine) emits approximately
192 g CO₂/km under mixed urban/suburban driving conditions (MyCC 2023).
This is used as the comparison baseline when showing users how much CO₂
they save by using public transport instead of driving.

## CO₂ Savings Calculation

For a given route:
```
transit_co2 = sum(distance_km × emission_factor for each leg)
car_co2     = total_distance_km × 192
co2_saved   = car_co2 - transit_co2
saved_pct   = (co2_saved / car_co2) × 100
```

## Tree Absorption Equivalent

To help users visualise the impact, CO₂ savings are also expressed as
"equivalent tree-days" — the number of days a mature tree would take to
absorb the same amount of CO₂.

A mature tree absorbs approximately 21 kg CO₂/year = 57.5 g/day.

```
tree_days = co2_saved_grams / 57.5
```

## Important Notes

- These are average/typical factors. Actual emissions vary with vehicle age,
  load factor, grid mix at time of travel, and route topology.
- The car baseline assumes a single occupant. Carpooling reduces per-person
  car emissions but public transport remains significantly lower per km.
- Emission factors are reviewed annually against updated MyCC and DOE data.
- For research or official reporting, always refer to primary sources:
  Malaysian Communications and Multimedia Commission (MyCC),
  Department of Environment Malaysia (DOE),
  Suruhanjaya Pengangkutan Awam Darat (SPAD/APAD).
