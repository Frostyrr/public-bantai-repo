import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CompactAmount from "../src/components/ui/CompactAmount";
import {
  formatCompactCurrency,
  formatCompactNumber,
  formatCompactPHP,
  formatExactCurrency,
  formatExactPHP,
  resolveCurrencyPrefix,
} from "../src/utils/formatCompactPHP";

test("resolveCurrencyPrefix maps PHP and supported currencies cleanly", () => {
  assert.equal(resolveCurrencyPrefix("PHP"), "₱");
  assert.equal(resolveCurrencyPrefix("php"), "₱");
  assert.equal(resolveCurrencyPrefix("₱"), "₱");
  assert.equal(resolveCurrencyPrefix(""), "₱");
  assert.equal(resolveCurrencyPrefix("USD"), "$");
  assert.equal(resolveCurrencyPrefix("EUR"), "€");
  assert.equal(resolveCurrencyPrefix("GBP"), "£");
  assert.equal(resolveCurrencyPrefix("JPY"), "¥");
  assert.equal(resolveCurrencyPrefix("CAD"), "CA$");
  assert.equal(resolveCurrencyPrefix("CHF"), "CHF ");
});

test("formatCompactPHP shows full formatted amounts below ₱100,000, trimming unnecessary .00", () => {
  assert.equal(formatCompactPHP(0), "₱0");
  assert.equal(formatCompactPHP(-0), "₱0");
  assert.equal(formatCompactPHP(-0.001), "₱0");
  assert.equal(formatCompactPHP(Number.NaN), "₱0");
  assert.equal(formatCompactPHP(Number.POSITIVE_INFINITY), "₱0");

  assert.equal(formatCompactPHP(0.05), "₱0.05");
  assert.equal(formatCompactPHP(0.5), "₱0.50");
  assert.equal(formatCompactPHP(1), "₱1");
  assert.equal(formatCompactPHP(500), "₱500");
  assert.equal(formatCompactPHP(1530), "₱1,530");
  assert.equal(formatCompactPHP(95_000), "₱95,000");
  assert.equal(formatCompactPHP(99_950), "₱99,950");

  assert.equal(formatCompactPHP(12.34), "₱12.34");
  assert.equal(formatCompactPHP(123.45), "₱123.45");
  assert.equal(formatCompactPHP(1532.45), "₱1,532.45");
  assert.equal(formatCompactPHP(99_999.99), "₱99,999.99");

  assert.equal(formatCompactPHP(1530, "USD"), "$1,530");
  assert.equal(formatCompactPHP(1532.45, "EUR"), "€1,532.45");
});

test("formatCompactPHP uses compact K notation starting at ₱100,000 with up to 5 significant digits", () => {
  assert.equal(formatCompactPHP(100_000), "₱100K");
  assert.equal(formatCompactPHP(150_500), "₱150.5K");
  assert.equal(formatCompactPHP(153_240), "₱153.24K");
  assert.equal(formatCompactPHP(153_245.67), "₱153.25K");
  assert.equal(formatCompactPHP(999_994), "₱999.99K");
  assert.equal(formatCompactPHP(999_995), "₱999.99K");
  assert.equal(formatCompactPHP(999_999.99), "₱999.99K");
});

test("formatCompactPHP uses compact M/B/T notation starting at ₱1,000,000 with up to 5 significant digits", () => {
  assert.equal(formatCompactPHP(1_000_000), "₱1M");
  assert.equal(formatCompactPHP(1_500_000), "₱1.5M");
  assert.equal(formatCompactPHP(1_530_000), "₱1.53M");
  assert.equal(formatCompactPHP(1_532_456.78), "₱1.5325M");
  assert.equal(formatCompactPHP(9_999_940), "₱9.9999M");
  assert.equal(formatCompactPHP(9_999_950), "₱10M");
  assert.equal(formatCompactPHP(12_300_000), "₱12.3M");
  assert.equal(formatCompactPHP(12_345_000), "₱12.345M");
  assert.equal(formatCompactPHP(99_999_400), "₱99.999M");
  assert.equal(formatCompactPHP(99_999_500), "₱100M");
  assert.equal(formatCompactPHP(153_245_000), "₱153.25M");
  assert.equal(formatCompactPHP(999_995_000), "₱999.99M");

  assert.equal(formatCompactPHP(1_000_000_000), "₱1B");
  assert.equal(formatCompactPHP(1_230_000_000), "₱1.23B");
  assert.equal(formatCompactPHP(1_234_500_000), "₱1.2345B");
  assert.equal(formatCompactPHP(999_995_000_000), "₱999.99B");
  assert.equal(formatCompactPHP(1_000_000_000_000), "₱1T");

  assert.equal(formatCompactCurrency(153_245_678n, "PHP"), "₱1.5325M");
  assert.equal(formatCompactCurrency("1230000000", "PHP"), "₱12.3M");
  assert.equal(formatCompactNumber(1532.45), "1,532.45");
  assert.equal(formatCompactNumber(-999_995), "-999.99K");
});

test("formatCompactPHP places minus sign before currency prefix for negative values", () => {
  assert.equal(formatCompactPHP(-1532.45), "-₱1,532.45");
  assert.equal(formatCompactPHP(-153_245), "-₱153.25K");
  assert.equal(formatCompactPHP(-1_532_456.78), "-₱1.5325M");
  assert.equal(formatCompactPHP(-999_995), "-₱999.99K");
  assert.equal(formatCompactCurrency(-20_000, "PHP"), "-₱200");
  assert.equal(formatCompactPHP(-1530, "USD"), "-$1,530");
});

test("formatExactCurrency and formatExactPHP preserve exact decimals and thousands separators", () => {
  assert.equal(formatExactCurrency(153_245_678, "PHP"), "₱1,532,456.78");
  assert.equal(formatExactCurrency(-153_245_678, "PHP"), "-₱1,532,456.78");
  assert.equal(formatExactCurrency(0, "PHP"), "₱0.00");
  assert.equal(formatExactCurrency(-0, "PHP"), "₱0.00");
  assert.equal(formatExactCurrency(153_245_678n, "PHP"), "₱1,532,456.78");
  assert.equal(formatExactCurrency("153245678", "PHP"), "₱1,532,456.78");
  assert.equal(formatExactPHP(1_532_456.78, "PHP"), "₱1,532,456.78");
});

test("CompactAmount renders accessible button with compact label and exact value metadata", () => {
  const markup = renderToStaticMarkup(
    createElement(CompactAmount, {
      centavos: 153_245_678,
      currency: "PHP",
    }),
  );

  assert.match(markup, /^<button type="button"/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /aria-haspopup="dialog"/);
  assert.match(markup, /aria-label="₱1\.5325M \(Exact amount: ₱1,532,456\.78\)"/);
  assert.match(markup, /title="₱1,532,456\.78"/);
  assert.match(markup, />₱1\.5325M<\/button>$/);

  const animatedSub100KMarkup = renderToStaticMarkup(
    createElement(CompactAmount, {
      amount: -1532.45,
      currency: "PHP",
      animate: true,
    }),
  );
  assert.match(animatedSub100KMarkup, /animate-metric-settle/);
  assert.match(animatedSub100KMarkup, /aria-label="-₱1,532\.45 \(Exact amount: -₱1,532\.45\)"/);
  assert.match(animatedSub100KMarkup, />-₱1,532\.45<\/span><\/button>$/);
});
