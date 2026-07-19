# Security Policy

## Reporting a Vulnerability

If you believe you have found a security vulnerability in this package, please
report it privately. **Do not open a public issue.**

- Use GitHub's [private vulnerability reporting](https://github.com/moderation-api/unicode-spoofing/security/advisories/new), or
- Email **security@moderationapi.com**

Please include a description of the issue, steps to reproduce, and the affected
version. We aim to acknowledge reports within 3 business days.

## Scope

This library classifies untrusted text. Reports of interest include: inputs
that cause the analyzer to crash, hang, or consume unbounded time/memory
(ReDoS-style), and correctness failures that let an obfuscated string bypass
detection or misclassify legitimate multilingual text.

## Responsible Disclosure

We appreciate responsible disclosure and will credit reporters who wish to be
acknowledged once a fix is released.
