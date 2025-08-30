-- Add is_selective column to scans table to track whether scan was selective or full-site
ALTER TABLE public.scans ADD COLUMN is_selective boolean DEFAULT false;

-- Add selected_urls column to store the URLs that were selected for crawling
ALTER TABLE public.scans ADD COLUMN selected_urls jsonb DEFAULT null;