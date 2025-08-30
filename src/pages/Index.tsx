
import { Hero } from '@/components/landing/Hero';
import { LandingNavigation } from '@/components/landing/LandingNavigation';
import FeaturesSection from '@/components/FeaturesSection';
import HowItWorksSection from '@/components/HowItWorksSection';
import PricingSection from '@/components/PricingSection';
import Footer from '@/components/Footer';

const Index = () => {
  return (
    <div className="min-h-screen">
      <LandingNavigation />
      <Hero />
      <section id="features">
        <FeaturesSection />
      </section>
      <section id="how-it-works">
        <HowItWorksSection />
      </section>
      <section id="pricing">
        <PricingSection />
      </section>
      <Footer />
    </div>
  );
};

export default Index;
