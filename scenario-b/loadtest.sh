#!/bin/bash
echo "==> Starting 5-minute multi-tenant workload generator..."
START_TIME=$SECONDS
END_TIME=$((SECONDS + 300))
TENANTS=("acme" "globex" "initech" "umbrella" "hooli")

TOTAL_REQUESTS=0

run_worker() {
  while [ $SECONDS -lt $END_TIME ]; do
    T=${TENANTS[$RANDOM % ${#TENANTS[@]}]}
    
    # Umbrella টেন্যান্টের জন্য ৫০০০ রো চাওয়া হচ্ছে (Unbounded Limit Problem)
    if [ "$T" == "umbrella" ]; then
      curl -s -o /dev/null -H "X-Tenant:$T" "http://localhost:3000/api/notes?limit=5000" &
    else
      curl -s -o /dev/null -H "X-Tenant:$T" "http://localhost:3000/api/notes?limit=20" &
    fi

    # অন্যান্য সব এন্ডপয়েন্টে ট্রাফিক
    curl -s -o /dev/null -H "X-Tenant:$T" "http://localhost:3000/api/search?q=test" &
    curl -s -o /dev/null -H "X-Tenant:$T" "http://localhost:3000/api/stats" &
    curl -s -o /dev/null -H "X-Tenant:$T" "http://localhost:3000/api/notes/1" &
    
    sleep 0.15
  done
}

# ৪টি ব্যাকগ্রাউন্ড প্যারালাল ওয়ার্কার চালু
for i in {1..4}; do
  run_worker &
done

# মাঝপথে ৩০ সেকেন্ডের কনকারেন্সি স্পাইক (১২০ থেকে ১৫০ সেকেন্ডের মধ্যে)
while [ $SECONDS -lt $END_TIME ]; do
  ELAPSED=$((SECONDS - START_TIME))
  
  if [ $ELAPSED -ge 120 ] && [ $ELAPSED -le 150 ]; then
    echo "[BURST ACTIVE] Concurrency spike active at ${ELAPSED}s elapsed..."
    for b in {1..8}; do
      curl -s -o /dev/null -H "X-Tenant:umbrella" "http://localhost:3000/api/notes?limit=2000" &
      curl -s -o /dev/null -H "X-Tenant:acme" "http://localhost:3000/api/search?q=data" &
    done
  fi
  sleep 5
done

wait
echo "==> Workload generation complete at $(date)."
