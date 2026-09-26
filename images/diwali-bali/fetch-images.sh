#!/bin/sh
# Downloads the ten illustrative Diwali-in-Bali images (AI-generated with
# Higgsfield, 3840x2160) and saves web-sized JPEGs next to this script.
# Run from the repo root on a Mac:  sh images/diwali-bali/fetch-images.sh
set -e
cd "$(dirname "$0")"
CDN=https://d8j0ntlcm91z4.cloudfront.net/user_3Hx4oN7VdnZSrZH3F61qpY9Thg3/hf_20260926_
for pair in \
  garland:022629_e7125e71-6fc8-4323-9ce9-22d77dd1d227 \
  surf:022629_d6c17433-259c-4264-9579-78dad230a6e2 \
  uluwatu:022629_f82a7bda-751b-4cb4-9b56-7204589a6dfe \
  flight:022657_65b4be5f-382e-40ce-91bd-bd3680f2283d \
  uluwatu-m:023527_3ca45118-182c-4c2c-9731-8c7645aa85e4 \
  flight-m:023527_6e5736bf-4d30-4897-b66f-42d661b99796 \
  garland-m:023527_7c78a2d1-96e0-4eed-942e-cea07dc1e8d3 \
  uluwatu-night:023527_5791ec48-4c13-44d9-80e4-a0be74a9a4e7 \
  flight-night:023527_ec76fcca-2cf1-4b28-8d8d-1ff311451c07 \
  garland-night:023527_26d5f6ed-947b-4c7e-92ed-ca5a866b37fe
do
  name=${pair%%:*}; id=${pair#*:}
  curl -fsSL -o "$name.png" "$CDN$id.png"
  # 2560px wide, JPEG quality ~72: sharp on 4K screens, ~500 KB each
  sips -s format jpeg -s formatOptions 72 -Z 2560 "$name.png" --out "$name.jpg" >/dev/null
  rm "$name.png"
  echo "saved $name.jpg"
done
