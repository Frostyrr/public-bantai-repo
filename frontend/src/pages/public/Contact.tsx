import React from 'react';
import Navbar from '../../components/layout/Navbar';
import Footer from '../../components/layout/Footer';
import ContactSection from '../../components/home/ContactSection';
import HomeFaq from '../../components/home/HomeFaq';

export const Contact: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#050507] text-white flex flex-col font-body font-normal relative">
      <Navbar />

      <main className="flex-1 flex flex-col relative z-10 pt-20">
        <ContactSection />
        <HomeFaq />
      </main>

      <Footer />
    </div>
  );
};

export default Contact;
