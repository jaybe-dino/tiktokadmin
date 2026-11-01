#!/bin/zsh
cd -- "${0:A:h}"
printf "브라우저에서 http://localhost:8783/ 을 여세요.\n"
exec python3 -m http.server 8783 --bind 127.0.0.1
