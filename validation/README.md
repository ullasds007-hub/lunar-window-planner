

\# Lunar Window Planner - Validation \& Testing Module



\## Overview

The Validation module checks the correctness and consistency of data used by Lunar Window Planner.



It helps identify invalid user inputs, incorrect Moon data, calculation errors, and invalid observation windows.



\## Module Components



\### 1. Input Validator

Checks:

\- Observation date

\- Latitude and longitude

\- Observation goal



\### 2. Moon Validator

Checks:

\- Moon illumination (0-100%)

\- Valid Moon phase

\- Moon age within one lunar cycle



\### 3. Calculation Validator

Checks:

\- Moon illumination

\- Moon age

\- Moon distance

\- Moon altitude

\- Numeric values and valid ranges



\### 4. Window Validator

Checks:

\- Observation goal

\- Start and end times

\- Time order

\- Moon illumination



\### 5. Validation Engine

Combines the individual validators and generates a validation report.



\## Folder Structure



```text

validation/

|-- validators/

|   |-- inputValidator.js

|   |-- moonValidator.js

|   |-- calculationValidator.js

|   |-- windowValidator.js

|

|-- tests/

|   |-- inputTests.js

|   |-- moonTests.js

|   |-- calculationTests.js

|   |-- windowTests.js

|

|-- reports/

|-- validationEngine.js

|-- README.md

```



\## Running Tests



From the project root directory, run:



```bash

node --test validation/tests/\*.js

```



\## Important Note

These validators perform structural and numerical checks. They do not independently prove the astronomical accuracy of Moon position or observation-window predictions. Scientific validation against trusted astronomical reference data is a future integration task.



\## Output

The validation engine returns:

\- Total checks

\- Passed checks

\- Failed checks

\- Overall validation status

\- Individual validation results



