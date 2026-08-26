-- BUG-25: 제품 단상자 영문 라벨 부착 사진 — 신청서 Step4 제품별 업로드 칸.
ALTER TABLE onb_products ADD COLUMN IF NOT EXISTS label_photo_url text NOT NULL DEFAULT '';
