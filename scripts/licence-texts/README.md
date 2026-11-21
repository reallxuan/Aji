# Standard licence texts

`scripts/third-party-notices.mjs` prints these for a component that ships no licence file of its own, so the About page carries the text its licence asks for. `{{copyright}}` is replaced by the component's authors, or "the <name> authors" when it names none.

| File | Licence | Taken from |
| --- | --- | --- |
| `MIT.txt` | MIT | The licence file of `serde` 1.0.229 (crates.io), rewrapped, with a copyright line added |
| `BSD-3-Clause.txt` | BSD-3-Clause | The licence file of `alloc-no-stdlib` 3.0.0 (crates.io), with its copyright line replaced |
| `MPL-2.0.txt` | MPL-2.0 | The licence file of `cssparser` 0.38.0 (crates.io), unchanged |

Each is the standard text of that licence as the SPDX licence list gives it. A component under any other licence and without a licence file makes the generator fail, so a new text is added here first.
