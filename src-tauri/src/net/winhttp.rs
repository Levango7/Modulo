use super::MAX_BODY;

/// WinHTTP 官方文档里的句柄类型名就是 `HINTERNET`。
/// 改名成 `InternetHandle` 能过 clippy，但查 MS 文档时对不上名字更费事，
/// 而这份代码的读者正是在对着文档写 FFI。局部 allow，不动 crate 级 lint。
#[allow(clippy::upper_case_acronyms)]
type HINTERNET = *mut core::ffi::c_void;

// WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY：走系统代理设置，而不是假定直连
const ACCESS_AUTOMATIC_PROXY: u32 = 0x0000_0004;
const FLAG_SECURE: u32 = 0x0080_0000;
const OPTION_CONNECT_TIMEOUT: u32 = 0x0000_0002;
const OPTION_SEND_TIMEOUT: u32 = 0x0000_0005;
const OPTION_RECEIVE_TIMEOUT: u32 = 0x0000_0006;

#[link(name = "winhttp")]
extern "system" {
    fn WinHttpOpen(
        agent: *const u16,
        access: u32,
        proxy: *const u16,
        proxy_bypass: *const u16,
        flags: u32,
    ) -> HINTERNET;
    fn WinHttpConnect(
        session: HINTERNET,
        server: *const u16,
        port: u16,
        reserved: u32,
    ) -> HINTERNET;
    fn WinHttpOpenRequest(
        connect: HINTERNET,
        verb: *const u16,
        object: *const u16,
        version: *const u16,
        referrer: *const u16,
        accept: *const u16,
        flags: u32,
    ) -> HINTERNET;
    fn WinHttpSendRequest(
        request: HINTERNET,
        headers: *const u16,
        headers_len: u32,
        optional: *const core::ffi::c_void,
        optional_len: u32,
        total_len: u32,
        context: usize,
    ) -> i32;
    fn WinHttpReceiveResponse(request: HINTERNET, reserved: *mut core::ffi::c_void) -> i32;
    fn WinHttpQueryDataAvailable(request: HINTERNET, available: *mut u32) -> i32;
    fn WinHttpReadData(
        request: HINTERNET,
        buffer: *mut core::ffi::c_void,
        to_read: u32,
        read: *mut u32,
    ) -> i32;
    fn WinHttpQueryHeaders(
        request: HINTERNET,
        level: u32,
        name: *const u16,
        name_len: *mut u32,
        buffer: *mut u16,
        buffer_len: *mut u32,
    ) -> i32;
    fn WinHttpSetOption(
        internet: HINTERNET,
        option: u32,
        buffer: *const core::ffi::c_void,
        buffer_len: u32,
    ) -> i32;
    fn WinHttpCloseHandle(internet: HINTERNET) -> i32;
    fn GetLastError() -> u32;
}

/// RAII：WinHTTP 的句柄不会自动释放，漏一次就是内核句柄泄漏。
struct Handle(HINTERNET);

impl Handle {
    /// 构造失败时返回 `Err`，成功时句柄由 `Drop` 负责关。
    fn acquire(raw: HINTERNET, what: &str) -> Result<Self, String> {
        if raw.is_null() {
            Err(format!("{what} 失败（Win32 错误 {}）", last_error_code()))
        } else {
            Ok(Self(raw))
        }
    }
    fn get(&self) -> HINTERNET {
        self.0
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: 构造时已排掉 null，且句柄由我们自己独占
            unsafe { WinHttpCloseHandle(self.0) };
        }
    }
}

fn last_error_code() -> u32 {
    // SAFETY: GetLastError 无参数、无副作用，只读本线程的 last-error 值
    unsafe { GetLastError() }
}

/// GET 一次。`host` / `target` 已由 `split_target` 拆好并过了边界。
///
/// 证书校验用 WinHTTP 默认行为（会验）：没有必要为省一次握手把校验关掉，
/// 而关掉它就等于允许任意中间人替换响应体 —— 对「监控」这种要拿结果做判断的功能，
/// 那会让整个判据失去意义。
pub fn get(host: &str, target: &str, url: &str) -> Result<(Option<u16>, String), String> {
    // SAFETY: 下面每个指针都指向本函数里活着的 Vec<u16>，长度以 NUL 结尾，
    // 且句柄都由 Handle 持有并在退出时关闭。
    unsafe {
        let agent = wide("Modulo/0.6");
        let session = Handle::acquire(
            WinHttpOpen(
                agent.as_ptr(),
                ACCESS_AUTOMATIC_PROXY,
                std::ptr::null(),
                std::ptr::null(),
                0,
            ),
            "打开 WinHTTP 会话",
        )?;

        // 超时：WinHTTP 默认 connect 是 60s、send/receive 是 30s，对一张卡片太久。
        // 超时必须显式报错，不能静默转成「今天没图」。
        for option in [
            OPTION_CONNECT_TIMEOUT,
            OPTION_SEND_TIMEOUT,
            OPTION_RECEIVE_TIMEOUT,
        ] {
            let ms: u32 = 10_000;
            WinHttpSetOption(
                session.get(),
                option,
                (&ms as *const u32).cast(),
                std::mem::size_of::<u32>() as u32,
            );
        }

        let host_w = wide(host);
        let connect = Handle::acquire(
            WinHttpConnect(session.get(), host_w.as_ptr(), 443, 0),
            &format!("连接 {host}"),
        )?;

        let verb = wide("GET");
        let target_w = wide(target);
        // 不传 WINHTTP_FLAG_REDIRECT：重定向一律原样报出（边界 3）
        let request = Handle::acquire(
            WinHttpOpenRequest(
                connect.get(),
                verb.as_ptr(),
                target_w.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                FLAG_SECURE,
            ),
            &format!("向 {host} 发起请求"),
        )?;

        if WinHttpSendRequest(
            request.get(),
            std::ptr::null(),
            0,
            std::ptr::null(),
            0,
            0,
            0,
        ) == 0
        {
            return Err(format!("发送请求失败（Win32 错误 {}）", last_error_code()));
        }
        if WinHttpReceiveResponse(request.get(), std::ptr::null_mut()) == 0 {
            return Err(format!(
                "{} 接收响应失败（Win32 错误 {}）",
                url,
                last_error_code()
            ));
        }

        // 状态码是「有就有」，查不到不算失败 —— 见 HttpResult::status 的说明
        let status = query_status(request.get());

        let mut body: Vec<u8> = Vec::new();
        loop {
            let mut available = 0u32;
            if WinHttpQueryDataAvailable(request.get(), &mut available) == 0 {
                return Err(format!(
                    "查询数据长度失败（Win32 错误 {}）",
                    last_error_code()
                ));
            }
            if available == 0 {
                break;
            }
            let mut chunk = vec![0u8; available as usize];
            let mut read = 0u32;
            if WinHttpReadData(
                request.get(),
                chunk.as_mut_ptr().cast(),
                available,
                &mut read,
            ) == 0
            {
                return Err(format!(
                    "读取响应体失败（Win32 错误 {}）",
                    last_error_code()
                ));
            }
            if read == 0 {
                break;
            }
            body.extend_from_slice(&chunk[..read as usize]);
            if body.len() > MAX_BODY {
                body.truncate(MAX_BODY);
                break;
            }
        }

        let body = String::from_utf8_lossy(&body).into_owned();
        Ok((status, body))
    }
}

/// 查 HTTP 状态码。
///
/// ⚠️ **本机这台机器上恒为 `None`**：`WinHttpQueryHeaders` 对
/// `WINHTTP_QUERY_STATUS_CODE`、带 `NUMBER` flag 的变体、`RAW_HEADERS_CRLF`、
/// `HEADERS_CRLF` 四种 info level 一律返回 FALSE + `ERROR_WINHTTP_SECURE_FAILURE(12150)`，
/// 而同一次请求的 Send/Receive 都成功、body 也能完整读出。用 curl 与 WinHttpRequest COM
/// 各验一遍都正常，所以这是该机器 WinHTTP 层的毛病，不是参数写法问题。
///
/// 这里仍然调一次而不是删掉：在能正常工作的地方（CI、其他机器）它是有效信息，
/// 拿不到就返回 `None`，前端显示成「已连接」而不是编一个数字。
fn query_status(request: HINTERNET) -> Option<u16> {
    const QUERY_STATUS_CODE: u32 = 0x0000_0009;
    // SAFETY: 第一次调用只问需要多少字节（此时 buffer 必须是 null），第二次带上足够大的缓冲。
    unsafe {
        let mut needed = 0u32;
        WinHttpQueryHeaders(
            request,
            QUERY_STATUS_CODE,
            std::ptr::null(),
            &mut needed,
            std::ptr::null_mut(),
            &mut needed,
        );
        if needed == 0 {
            return None;
        }
        let mut buf = vec![0u16; needed as usize / 2 + 1];
        // 那个 +1 是给结尾的 NUL 留位（下面按 utf16 读到 0 就停）
        let mut len: u32 = needed + 1;
        if WinHttpQueryHeaders(
            request,
            QUERY_STATUS_CODE,
            std::ptr::null(),
            std::ptr::null_mut(),
            buf.as_mut_ptr(),
            &mut len,
        ) == 0
        {
            return None;
        }
        let mut end = 0usize;
        while end < buf.len() && buf[end] != 0 {
            end += 1;
        }
        String::from_utf16_lossy(&buf[..end]).trim().parse().ok()
    }
}

/// NUL 结尾的 UTF-16。WinHTTP 全部接口要这个形状。
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}
