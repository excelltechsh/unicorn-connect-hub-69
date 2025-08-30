import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ExternalLink, Search } from "lucide-react";

interface Page {
  url: string;
  title: string;
  description: string;
}

interface PageSelectorProps {
  pages: Page[];
  onBack: () => void;
  onStartScan: (selectedUrls: string[]) => void;
  isLoading: boolean;
}

export default function PageSelector({ pages, onBack, onStartScan, isLoading }: PageSelectorProps) {
  const [selectedPages, setSelectedPages] = useState<string[]>([]);

  const handlePageToggle = (url: string) => {
    setSelectedPages(prev => {
      if (prev.includes(url)) {
        return prev.filter(p => p !== url);
      } else if (prev.length < 5) {
        return [...prev, url];
      }
      return prev;
    });
  };

  const handleStartScan = () => {
    if (selectedPages.length > 0) {
      onStartScan(selectedPages);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="sm"
          onClick={onBack}
          disabled={isLoading}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div>
          <h2 className="text-xl font-semibold text-foreground">Select Pages to Analyze</h2>
          <p className="text-muted-foreground">Choose up to 5 pages for detailed analysis</p>
        </div>
      </div>

      {/* Selection Summary */}
      <Card className="p-4 border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant={selectedPages.length > 0 ? "default" : "secondary"} className="font-medium">
              {selectedPages.length}/5 selected
            </Badge>
            <span className="text-sm text-muted-foreground">
              {pages.length} pages found
            </span>
          </div>
          <Button
            onClick={handleStartScan}
            disabled={selectedPages.length === 0 || isLoading}
            className="flex items-center gap-2"
          >
            <Search className="h-4 w-4" />
            Start Analysis
          </Button>
        </div>
      </Card>

      {/* Pages List */}
      <div className="space-y-3">
        {pages.map((page, index) => {
          const isSelected = selectedPages.includes(page.url);
          const canSelect = selectedPages.length < 5 || isSelected;

          return (
            <Card
              key={page.url}
              className={`p-4 transition-all duration-200 border ${
                isSelected 
                  ? 'border-primary bg-primary/5' 
                  : canSelect 
                    ? 'border-border hover:border-primary/50 cursor-pointer' 
                    : 'border-border opacity-50 cursor-not-allowed'
              }`}
              onClick={() => canSelect && handlePageToggle(page.url)}
            >
              <div className="flex items-start gap-4">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => canSelect && handlePageToggle(page.url)}
                  disabled={!canSelect}
                  className="mt-1"
                />
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-foreground truncate">
                        {page.title}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {page.description}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded truncate">
                          {page.url}
                        </span>
                        <a
                          href={page.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {pages.length === 0 && (
        <Card className="p-8 text-center border border-border">
          <div className="text-muted-foreground">
            <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">No pages found</p>
            <p className="text-sm">
              We couldn't discover any pages for this website. 
              Try a different URL or check if the site is accessible.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}