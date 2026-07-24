document.addEventListener('DOMContentLoaded', () => {
    // A/B Testing Logic
    const variants = {
        security: {
            bg: 'assets/hero-security.png',
            h1: 'Hệ thống Họp trực tuyến Siêu bảo mật cho Doanh nghiệp',
            p: 'Giải pháp tự lưu trữ (On-premise) tối ưu dành cho khối Chính phủ và Tập đoàn lớn tại Việt Nam.'
        },
        onprem: {
            bg: 'assets/hero-onpremise.png',
            h1: 'Tự chủ hạ tầng, Bảo mật tuyệt đối dữ liệu cuộc họp',
            p: 'Triển khai On-premise hoàn toàn, không phụ thuộc internet, hoạt động trong mạng LAN/VPN.'
        },
        scale: {
            bg: 'assets/hero-scale.png',
            h1: 'Hội nghị trực tuyến quy mô lớn đến 1.000 điểm cầu',
            p: 'Kết nối không giới hạn, hình ảnh 4K sắc nét và âm thanh trung thực cho mọi cuộc họp quy mô lớn.'
        }
    };

    // Determine variant
    const urlParams = new URLSearchParams(window.location.search);
    let currentVariant = urlParams.get('variant');

    if (!variants[currentVariant]) {
        const variantKeys = Object.keys(variants);
        currentVariant = variantKeys[Math.floor(Math.random() * variantKeys.length)];
    }

    // Apply variant
    const hero = document.getElementById('hero');
    const heroTitle = document.getElementById('hero-title');
    const heroDesc = document.getElementById('hero-desc');

    if (hero && heroTitle && heroDesc) {
        hero.style.backgroundImage = `url(${variants[currentVariant].bg})`;
        heroTitle.textContent = variants[currentVariant].h1;
        heroDesc.textContent = variants[currentVariant].p;
        console.log(`Current A/B Variant applied: ${currentVariant}`);
    }

    // Sticky Header & CTA Visibility
    const header = document.querySelector('header');
    const stickyCta = document.getElementById('sticky-cta');
    const heroBtn = document.querySelector('.hero .btn-primary');

    window.addEventListener('scroll', () => {
        // Header scroll effect
        if (window.scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }

        // Sticky CTA visibility
        if (heroBtn) {
            const rect = heroBtn.getBoundingClientRect();
            if (rect.top < 0) {
                stickyCta.classList.add('visible');
            } else {
                stickyCta.classList.remove('visible');
            }
        }
    });

    // Intersection Observer for scroll animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const sectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
                sectionObserver.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('section').forEach(section => {
        section.classList.add('fade-ready');
        sectionObserver.observe(section);
    });

    // FAQ Accordion
    const faqItems = document.querySelectorAll('.faq-item');
    faqItems.forEach(item => {
        const btn = item.querySelector('.faq-question');
        btn.addEventListener('click', () => {
            const isActive = item.classList.contains('active');

            // Close all
            faqItems.forEach(i => i.classList.remove('active'));

            // Toggle current
            if (!isActive) {
                item.classList.add('active');
            }
        });
    });

    const BLOCKED_EMAIL_DOMAINS = [
        'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.com.vn',
        'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com',
        'protonmail.com', 'proton.me', 'mail.ru', 'yandex.com', 'yandex.ru'
    ];

    function isValidBusinessEmail(email) {
        const domain = email.split('@')[1]?.toLowerCase();
        return domain && !BLOCKED_EMAIL_DOMAINS.includes(domain);
    }

    // Form Handling
    const leadForm = document.getElementById('lead-form');
    if (leadForm) {
        leadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(leadForm);
            const data = Object.fromEntries(formData.entries());

            if (!isValidBusinessEmail(data.email)) {
                alert('Vui lòng sử dụng email công việc (doanh nghiệp), không chấp nhận email cá nhân như Gmail, Hotmail.');
                return;
            }

            // Add visual feedback
            const submitBtn = leadForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Đang gửi...';

            try {
                // TrueConf WebChat Contact API Integration
                const response = await fetch('/api/contact', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        company: data.company,
                        name: data.name,
                        position: data.position,
                        email: data.email,
                        phone: data.phone,
                        scale: data.scale,
                        subject: `New Lead from ${data.company}`,
                        message: data.message
                    })
                });

                if (response.ok) {
                    alert('Cảm ơn bạn! Chúng tôi sẽ liên hệ lại sớm nhất.');
                    submitBtn.textContent = 'Gửi thành công!';
                    leadForm.reset();
                } else {
                    const error = await response.json();
                    throw new Error(error.message || 'Failed to send');
                }

                setTimeout(() => {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalText;
                }, 2000);
            } catch (err) {
                console.error('Submission error:', err);
                alert('Có lỗi xảy ra, vui lòng thử lại sau.');
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        });
    }

    // GA4 / GTM Placeholder
    window.dataLayer = window.dataLayer || [];
    function gtag() { dataLayer.push(arguments); }
    // gtag('js', new Date());
    // gtag('config', 'G-XXXXXXXXXX');
});
