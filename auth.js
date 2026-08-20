// ==========================================
// KITT OP 會員認證模組 (Google Identity Services)
// ==========================================

const CLIENT_ID = "143544358033-l40q5c74kn32bb9hl2gh1o5kvrnekbjh.apps.googleusercontent.com";
const GAS_URL = "https://script.google.com/macros/s/AKfycbw2FMlLYCU1h3nRijUHfZKuKXyZeu4_DrYGR393_z3hB4HRwQctwapoPnPK2EKY4qXL_g/exec";

// 簡單的 JWT 解析函數 (不依賴外部 library)
function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        console.error("JWT 解析失敗", e);
        return null;
    }
}

// 處理 Google 登入成功的回呼函數
window.handleCredentialResponse = async function(response) {
    const payload = parseJwt(response.credential);
    if (!payload) return;

    // 取得使用者資訊
    const userData = {
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        token: response.credential
    };

    // 儲存在瀏覽器
    localStorage.setItem("kitt_user", JSON.stringify(userData));
    updateAuthUI();

    // 背景發送至 GAS 寫入 Google Sheet
    try {
        const formData = new URLSearchParams();
        formData.append("type", "login");
        formData.append("email", userData.email);
        formData.append("name", userData.name);
        formData.append("picture", userData.picture);

        fetch(GAS_URL, {
            method: 'POST',
            body: formData
        }).then(res => res.json())
          .then(data => console.log("資料庫紀錄：", data))
          .catch(err => console.error("GAS 紀錄失敗", err));

        // 登入成功提示
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'success',
                title: `歡迎回來，${userData.name}`,
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000
            });
        }
    } catch (e) {
        console.error(e);
    }
};

// 更新登入 UI 狀態
function updateAuthUI() {
    const userJson = localStorage.getItem("kitt_user");
    const loginBtnContainer = document.getElementById("google-login-container");
    const userProfileContainer = document.getElementById("user-profile-container");

    if (userJson) {
        const user = JSON.parse(userJson);
        if (loginBtnContainer) loginBtnContainer.style.display = 'none';
        if (userProfileContainer) {
            userProfileContainer.style.display = 'flex';
            document.getElementById("user-avatar").src = user.picture;
            document.getElementById("user-name").textContent = user.name;
        }
    } else {
        if (loginBtnContainer) loginBtnContainer.style.display = 'block';
        if (userProfileContainer) userProfileContainer.style.display = 'none';
    }
}

// 登出功能
window.logoutUser = function() {
    localStorage.removeItem("kitt_user");
    updateAuthUI();
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            icon: 'info',
            title: '已登出',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 2000
        });
    }
};

// 權限檢查器：如果未登入則彈出警告並回傳 false
window.checkAuth = function(featureName) {
    const user = localStorage.getItem("kitt_user");
    if (!user) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'info',
                title: '免費加入會員看更多',
                html: `
                    <div class="text-sm text-slate-500 mb-4 mt-2 font-medium">記得登入會員，即可免費解鎖「${featureName}」等全部功能！</div>
                    <div id="swal-google-btn-container" class="flex justify-center mt-4 min-h-[44px]"></div>
                `,
                showConfirmButton: false,
                showCloseButton: true,
                didOpen: () => {
                    if (window.google && google.accounts && google.accounts.id) {
                        google.accounts.id.renderButton(
                            document.getElementById("swal-google-btn-container"),
                            { theme: "outline", size: "large", type: "standard", text: "signin_with", shape: "rectangular" }
                        );
                    }
                }
            });
        } else {
            alert(`免費加入會員看更多！\n請先點擊左上方「Google 登入」按鈕，即可免費解鎖「${featureName}」等全部功能！`);
        }
        return false;
    }
    return true;
};

// 網頁載入時初始化
document.addEventListener("DOMContentLoaded", () => {
    updateAuthUI();
});
