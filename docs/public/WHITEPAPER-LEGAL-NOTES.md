# Appendix A — Legal, Trademark & Disclosure Notes

*These notes apply to this whitepaper and to every Vibgrate whitepaper. They are
maintained as a single shared appendix and reproduced with each paper.*

## Trademarks

**DriftRisk™** is a trademark of Vibgrate. **Vibgrate®** is a registered
trademark of Vibgrate. *DriftScore* and *RiskScore* are not trademarked. All
other trademarks, service marks, and trade names appearing in this document
(including, without limitation, CISA KEV, EPSS, CVSS, NIST, SSVC, OpenSSF
Scorecard, OSV, GHSA, and libyear) are the property of their respective owners
and are used solely for nominative and descriptive purposes to identify the data
sources and methodologies referenced herein.

## Open method, proprietary calibration

Vibgrate publishes the methodology, factors, data sources, formulas, bands, and
rationale for its scoring systems. The exact tuned weights, calibration
constants, and the breaking-change intelligence corpus remain proprietary. This
posture follows established industry precedents for transparent yet commercially
sustainable security scoring systems — the credit-bureau model of open method,
proprietary calibration.

## Public specification

The algorithm and formulas for DriftRisk™ (`driftrisk-1.1`) are specified in full
in the accompanying whitepaper and in
[`SCORING-METHODOLOGY-PUBLIC.md`](https://github.com/vibgrate/cli/blob/main/docs/public/SCORING-METHODOLOGY-PUBLIC.md),
which is made available under an open-source license (see the repository for
current license terms). DriftScore and RiskScore methodology details are disclosed to the
extent necessary to understand, audit, and challenge published scores.

## No warranty or guarantee

The information in this whitepaper, and any scores produced by Vibgrate software,
are provided **"as is"** and **"as available"** without warranty of any kind,
express or implied, including without limitation the implied warranties of
merchantability, fitness for a particular purpose, and non-infringement. Vibgrate
makes no representation or warranty that any score is accurate, complete,
reliable, or fit for any particular purpose. Scores are tools to assist human
decision-making; they are not a substitute for professional security assessment,
penetration testing, or legal review.

## Third-party data sources

Vibgrate incorporates or references data from third-party sources (including,
without limitation, CISA, FIRST, NIST, OSV, and GHSA). Vibgrate does not control,
verify, or endorse the accuracy or completeness of such third-party data, and
users are encouraged to consult the original sources directly. Each score is
stamped with the feed snapshot dates it was computed from, so any figure can be
traced back to the source data as it stood at computation time.

## Governing law

This document, and any dispute arising out of or in connection with it, shall be
governed by and construed in accordance with the laws of **England and Wales**,
without regard to its conflict-of-law principles, and shall be subject to the
exclusive jurisdiction of the courts of **England and Wales**.
