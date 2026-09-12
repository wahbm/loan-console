# Loan calculation specification

## Scope

The V1 engine is a deterministic monthly schedule calculator. It assumes every due installment before `asOf` was paid on time. It does not model daily interest, delinquency, fees, penalties, grace periods, or bank statements.

## Precision

- Money and rates are represented as decimal strings at API boundaries.
- The engine uses `decimal.js`; JavaScript floating point is not used for financial operations.
- Money is rounded with `ROUND_HALF_UP` to two decimal places at the installment-line level.
- The final period absorbs the principal rounding remainder so final balance is exactly `0.00`.

## Dates

`firstPaymentDate` is the monthly anchor. Dates are generated from the original anchor rather than repeatedly adding one month. If the anchor is the last day of its month, every later date is the last day of its month. Otherwise the original day number is used when available, or the target month's last day is used.

## Repayment methods

For equal payment (`equal_payment`), payment is recalculated per rate segment:

```text
payment = P × r × (1 + r)^n / ((1 + r)^n - 1)
```

When `r = 0`, payment is `P / n`.

For equal principal (`equal_principal`), principal is `P / n` for the segment and payment is principal plus opening balance interest.

## Rate boundaries

The initial rate is active for the first payment. A later rate period is mapped to the first payment boundary on or after its effective date. The installment at that boundary uses the previous rate; the new rate is active from the next installment.

At each boundary:

1. Calculate the installment with the active terms.
2. Record closing principal.
3. Apply rate changes mapped to the boundary.
4. Apply prepayment events mapped to the boundary.
5. Generate the next segment with the new principal, rate, and remaining periods.

## Prepayment

Each component receives its own allocation. The first payment boundary on or after the input date is selected. That boundary's regular installment is calculated first; the allocation is then deducted from the post-installment balance and the next segment is regenerated.

An allocation is the principal-reduction amount only. Any bank-collected accrued interest between the last scheduled payment and the prepayment date is outside the V1 monthly model and must not be added to the allocation. It may be supplied separately as `interestAmount`; this amount is recorded as an additional prepayment cost, does not reduce principal, and does not create a monthly schedule row.

The comparison returns both the planned interest reduction and the net lifetime interest reduction:

```text
totalInterestSaved = before.totalInterest - after.totalInterest
netSavedInterest = totalInterestSaved - sum(prepayment interestAmount)
```

`interestAmount` is an explicitly supplied settlement value. V1 does not infer it from dates or rates and therefore cannot guarantee a bank-level daily-interest result without the bank's actual settlement rules or statement amount.

- `reduce_term`: equal payment keeps the current segment's scheduled payment; equal principal keeps the segment's fixed principal amount. Future rate boundaries can still change the payment.
- `reduce_payment`: remaining periods are kept; equal payment recalculates payment and equal principal recalculates fixed principal.

An allocation of zero is valid. Negative allocations and allocations larger than the boundary balance are invalid. An allocation equal to the balance closes the component.

## asOf metrics

Rows with `paymentDate <= asOf` are treated as due. Paid interest is the sum of those rows' interest. Remaining principal is the balance after the last due row, or original principal if no row is due. The next payment is the first row after `asOf`.
