/* 
 * KITT OP - Theme JS
 * 處理深淺色切換與表格四階顏色層級共用邏輯
 */

// 頁面載入時立即套用主題 (避免閃爍)
document.addEventListener('DOMContentLoaded', initTheme);

function initTheme() {
    const savedTheme = localStorage.getItem('kitt_theme') || 'dark';
    if (savedTheme === 'light') {
        document.body.classList.add('theme-light');
    }
    updateThemeUI();
}

// 點擊切換主題
function toggleTheme() {
    document.body.classList.toggle('theme-light');
    const isLight = document.body.classList.contains('theme-light');
    localStorage.setItem('kitt_theme', isLight ? 'light' : 'dark');
    updateThemeUI();
}

// 監聽其他標籤頁的設定變更
window.addEventListener('storage', (e) => {
    if (e.key === 'kitt_theme') {
        if (e.newValue === 'light') {
            document.body.classList.add('theme-light');
        } else {
            document.body.classList.remove('theme-light');
        }
        updateThemeUI();
    }
});

// 更新按鈕的圖示與文字
function updateThemeUI() {
    const isLight = document.body.classList.contains('theme-light');
    const themeIcon = document.getElementById('themeIcon');
    const themeText = document.getElementById('themeText');
    
    // 更新按鈕文字與圖示
    if (themeIcon) {
        themeIcon.innerText = isLight ? '☀️' : '🌙';
    }
    if (themeText) {
        themeText.innerText = isLight ? '拿鐵淺色' : '科技深色';
    }
    
    // 更新左上角與手機版 LOGO
    const logoIcons = document.querySelectorAll('.logo-icon');
    logoIcons.forEach(icon => {
        icon.innerText = isLight ? '☕' : '⚡';
    });
}

// 供所有表格渲染共用的四階顏色 Class 判斷函數
function getRelativeColorClass(valStr, avg) {
    const val = parseInt(valStr);
    if (isNaN(val)) return "color-lv0";
    if (val > avg * 1.5) return "color-lv3"; // 極高波動
    if (val > avg * 1.2) return "color-lv2"; // 高波動
    if (val > avg * 0.9) return "color-lv1"; // 中高波動
    return "color-lv0"; // 日常波動
}

// ================= 手機版側邊欄 =================
function toggleMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobileOverlay');
    if (sidebar && overlay) {
        if (sidebar.classList.contains('-translate-x-full')) {
            sidebar.classList.remove('-translate-x-full');
            overlay.classList.remove('hidden');
        } else {
            sidebar.classList.add('-translate-x-full');
            overlay.classList.add('hidden');
        }
    }
}
