CPU: x86_64, 4 cores, single-thread inference, batch 1

| model | params | precision | seq len | p50 ms | p95 ms |
|---|---|---|---|---|---|
| transformer-tiny | 155k | fp32 | 32 | 0.26 | 0.36 |
| transformer-tiny | 155k | fp32 | 128 | 0.91 | 1.06 |
| transformer-tiny | 155k | fp32 | 512 | 5.06 | 6.49 |
| transformer-tiny | 155k | int8 | 32 | 0.22 | 0.30 |
| transformer-tiny | 155k | int8 | 128 | 0.77 | 0.96 |
| transformer-tiny | 155k | int8 | 512 | 4.42 | 5.08 |
| transformer-tiny AS SEQ2SEQ (1 pass/byte) | 155k | int8 | 32 | 6.5 | — |
| transformer-tiny AS SEQ2SEQ (1 pass/byte) | 155k | int8 | 128 | 59.6 | — |
| transformer-small | 442k | fp32 | 32 | 0.56 | 0.69 |
| transformer-small | 442k | fp32 | 128 | 1.97 | 2.07 |
| transformer-small | 442k | fp32 | 512 | 12.38 | 13.67 |
| transformer-small | 442k | int8 | 32 | 0.39 | 0.58 |
| transformer-small | 442k | int8 | 128 | 1.47 | 1.67 |
| transformer-small | 442k | int8 | 512 | 10.12 | 12.21 |
| transformer-small AS SEQ2SEQ (1 pass/byte) | 442k | int8 | 32 | 9.5 | — |
| transformer-small AS SEQ2SEQ (1 pass/byte) | 442k | int8 | 128 | 109.5 | — |
| transformer-base | 1.45M | fp32 | 32 | 1.79 | 1.94 |
| transformer-base | 1.45M | fp32 | 128 | 7.01 | 7.28 |
| transformer-base | 1.45M | fp32 | 512 | 45.04 | 48.11 |
| transformer-base | 1.45M | int8 | 32 | 1.14 | 1.37 |
| transformer-base | 1.45M | int8 | 128 | 5.09 | 6.57 |
| transformer-base | 1.45M | int8 | 512 | 35.50 | 39.00 |
| transformer-base AS SEQ2SEQ (1 pass/byte) | 1.45M | int8 | 32 | 27.0 | — |
| transformer-base AS SEQ2SEQ (1 pass/byte) | 1.45M | int8 | 128 | 316.8 | — |
| cnn-tiny | 85k | fp32 | 32 | 0.16 | 0.22 |
| cnn-tiny | 85k | fp32 | 128 | 0.54 | 0.61 |
| cnn-tiny | 85k | fp32 | 512 | 1.96 | 2.14 |
| cnn-tiny | 85k | int8 | 32 | 0.71 | 0.80 |
| cnn-tiny | 85k | int8 | 128 | 2.29 | 2.81 |
| cnn-tiny | 85k | int8 | 512 | 8.56 | 9.01 |
| cnn-small | 375k | fp32 | 32 | 0.50 | 0.56 |
| cnn-small | 375k | fp32 | 128 | 1.65 | 1.75 |
| cnn-small | 375k | fp32 | 512 | 7.06 | 8.64 |
| cnn-small | 375k | int8 | 32 | 2.22 | 2.50 |
| cnn-small | 375k | int8 | 128 | 7.81 | 8.30 |
| cnn-small | 375k | int8 | 512 | 29.44 | 30.85 |
| cnn-base | 993k | fp32 | 32 | 1.11 | 1.24 |
| cnn-base | 993k | fp32 | 128 | 3.73 | 4.10 |
| cnn-base | 993k | fp32 | 512 | 16.47 | 17.74 |
| cnn-base | 993k | int8 | 32 | 4.17 | 4.40 |
| cnn-base | 993k | int8 | 128 | 16.54 | 17.91 |
| cnn-base | 993k | int8 | 512 | 70.49 | 73.67 |
| gru-tiny | 79k | fp32 | 32 | 0.14 | 0.25 |
| gru-tiny | 79k | fp32 | 128 | 0.54 | 0.61 |
| gru-tiny | 79k | fp32 | 512 | 1.99 | 2.48 |
| gru-tiny | 79k | int8 | 32 | 0.13 | 0.24 |
| gru-tiny | 79k | int8 | 128 | 0.54 | 0.62 |
| gru-tiny | 79k | int8 | 512 | 1.95 | 2.47 |
| gru-small | 155k | fp32 | 32 | 0.30 | 0.43 |
| gru-small | 155k | fp32 | 128 | 0.96 | 1.03 |
| gru-small | 155k | fp32 | 512 | 3.63 | 4.19 |
| gru-small | 155k | int8 | 32 | 0.25 | 0.36 |
| gru-small | 155k | int8 | 128 | 0.93 | 1.01 |
| gru-small | 155k | int8 | 512 | 3.48 | 4.69 |
| gru-base | 552k | fp32 | 32 | 0.88 | 1.12 |
| gru-base | 552k | fp32 | 128 | 3.21 | 4.81 |
| gru-base | 552k | fp32 | 512 | 11.92 | 13.28 |
| gru-base | 552k | int8 | 32 | 0.88 | 0.94 |
| gru-base | 552k | int8 | 128 | 3.15 | 4.21 |
| gru-base | 552k | int8 | 512 | 11.71 | 13.49 |
| byt5-small (real, generate 48 tokens) | 300M | fp32 | ~40 in | 1574 | — |
<!-- byt5 output: ' fr€€ crýpt0 n0w l1mited t1me 0ffer€€ ' -->
