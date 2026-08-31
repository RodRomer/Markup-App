/** Money, formatted the same way wherever it appears.
 *
 *  The client's running total used this and the staff console concatenated the
 *  raw number, so the same price read as "$1,250.50" on one screen and
 *  "$1250.5" on the other -- and the second is easy to take for $12,505 at a
 *  glance, which is the kind of misreading a price should not invite.
 *
 *  Intl rather than toFixed, so the thousands separator is there. USD because
 *  that is what these projects are priced in; this is the one place to change
 *  if that stops being true.
 */
export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    // A whole number shows as $125 rather than $125.00, but anything with
    // cents keeps them -- a price of 1250.5 must not read as 1250.
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
