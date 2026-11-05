# 🦆 Vịt Đua · Quỹ Mùa Giải

Game đua vịt tiếng Việt cho 3–100 người chơi trên một màn hình chung. Mỗi người chọn một con vịt theo thiên phú. Khi vịt xuống nước, skill bí mật và rune có thể đảo thứ hạng ngay sát đích.

**[Chơi Vịt Đua trên trình duyệt](https://vit-dua-phu-20261104.hoangbaophu89.chatgpt.site/)**

![Một vòng đua với 7 con vịt](docs/duong-dua.jpg)

## Chạy trên máy

Tải repo về rồi mở `dist/index.html` trong trình duyệt. Nếu có Python 3, bạn có thể chạy game qua HTTP từ thư mục gốc của repo bằng lệnh sau.

```sh
python -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Mở [game trên máy](http://127.0.0.1:8000). Dùng cùng trình duyệt và địa chỉ cho các lần chơi tiếp theo để mở lại mùa đã lưu. Game dùng HTML, CSS và JavaScript thuần. Trình duyệt có thể tải phông Be Vietnam Pro từ Google Fonts và dùng phông hệ thống khi ngoại tuyến.

## Bắt đầu mùa và ngày đua

1. Chọn **Mùa mới**, đặt tên mùa, nhập 3–100 người (mỗi dòng một tên riêng biệt) và chọn ngày đầu tiên.
2. Mặc định mỗi ngày có **10 vòng**, mỗi vòng **25 giây**. Có thể đặt 1–100 vòng/ngày và 10–600 giây/vòng khi tạo ngày đó.
3. Danh sách người chơi giữ nguyên trong một mùa. Muốn đổi danh sách, chốt mùa đang mở rồi tạo mùa mới.
4. Mùa không giới hạn số ngày. **Ngày đua mới** sử dụng lại danh sách người của mùa và bắt đầu điểm ngày từ 0.
5. Mỗi ngày lịch chỉ có một ngày đua trong mùa. Ngày mới phải sau ngày thi đấu gần nhất; phải hoàn tất ngày đang chơi, kể cả đua phụ, trước khi thêm ngày mới.

## Thứ tự chọn vịt

- Vòng đầu mỗi ngày chọn theo thứ tự danh sách người chơi.
- Từ vòng thứ hai, người **chót vòng trước chọn đầu tiên**, tiếp theo là kế chót, rồi lần lượt lên trên; người về nhất chọn cuối cùng. Dùng kết quả của **vòng vừa đua**, không dùng tổng điểm ngày.
- Chỉ người đang đến lượt được chọn. Mỗi người một vịt, mỗi vịt một chủ; người còn lại chờ đúng lượt.
- **Ngẫu nhiên cho lượt này** chỉ chọn một vịt còn trống cho người đang đến lượt, không tự chọn hết cho cả nhóm.
- **Hoàn tác lựa chọn cuối** chỉ gỡ lựa chọn gần nhất. Có thể hoàn tác nhiều lần rồi chọn lại, nhưng vẫn phải đi theo thứ tự ưu tiên.
- Đua phụ dùng thứ tự từ chót lên nhất của vòng thường cuối cùng, lọc còn những người phải phân định.

## Thiên phú, skill bí mật và rune

Các vòng mới của mùa giải dùng cơ chế `chaos-v1`: **xem thiên phú → chọn đủ vịt → xuất phát mới lộ skill → rune xuất hiện trong lúc đua**. Mỗi người vẫn chọn lại một vịt mỗi vòng. Thiên phú ổn định theo số vịt, còn skill được chia lại độc lập khi xuất phát; không thể xem skill rồi hoàn tác lựa chọn.

Với 7 người, bảy vịt đầu có các thiên phú sau:

| Vịt | Thiên phú | Hiệu ứng |
| --- | --- | --- |
| Vàng | Đều chân | +2% tốc độ cơ bản cả trận |
| Hồng | Hợp rune | +1,5% tốc độ cơ bản; rune tăng tốc kéo dài thêm 30%, hiệu ứng chậm từ rune ngắn hơn 30% |
| Xanh | Không bỏ cuộc | +5% tốc độ cơ bản khi thuộc 3 vị trí cuối |
| Tím | Mỏ neo | +1,5% tốc độ cơ bản; 50% cơ hội kháng swap khiến mình tụt lại |
| Cam | Đề-pa | +10% tốc độ cơ bản trong 5 giây đầu |
| Mint | Lì đòn | +1,5% tốc độ cơ bản; giảm 40% thời gian bị làm chậm |
| Đào | Nước rút | +10% tốc độ cơ bản trong 5 giây cuối |

Nếu có hơn 7 vịt, bộ thiên phú lặp theo **số vịt**, và từng thẻ ghi rõ thiên phú của nó. Khi số vịt khác 7, Không bỏ cuộc áp dụng cho nhóm cuối có `ceil(3 × N / 7)` vịt. Phần cộng tốc độ tính theo tốc độ cơ bản, không nhân chồng với skill hoặc rune. Chỉ số được kiểm tra với mặc định 7 người, 25 giây; thay đổi thời lượng hoặc số người có thể làm tương quan thiên phú khác đi.

Mỗi vịt có một skill tự kích hoạt tối đa một lần:

- **Chân vịt phản lực:** +70% tốc độ cơ bản trong 1,5 giây.
- **Bom xỉn:** ném một đối thủ ngẫu nhiên, làm chậm 40% trong 1,5 giây trước khi áp dụng kháng.
- **Phao hộ mệnh:** chặn một lần trúng đòn hoặc swap khiến vịt tụt lại. Phao không có thời hạn và không cộng dồn nhiều lớp.
- **Đổi đời:** đổi vị trí với một đối thủ ngẫu nhiên khi còn 2 giây, có thể tự đổi từ đầu xuống cuối. 25% cơ hội mỗi trận có một vịt mang skill này; tối đa một lần thử swap trong trận.

Khi swap gây tụt lại, chỉ vịt chịu thiệt được kiểm tra phao hoặc Mỏ neo, kể cả khi nó tự kích hoạt skill. Phao chặn trước; nếu không có phao, Mỏ neo có 50% cơ hội kháng. Chặn thành công hủy cả lần đổi, hai vịt giữ nguyên vị trí. Swap không đổi chủ, màu hay skill.

Rune xuất hiện ở các làn ngẫu nhiên, không ưu tiên vịt dẫn đầu. Có ít nhất 3 rune mỗi trận: **Nước tăng lực** (+40% trong 1,5 giây), **Bong bóng bảo vệ** (một lần chặn) và **Hộp hên xui** (50% tăng tốc, 50% gây chậm). Hợp rune thay đổi thời lượng tăng tốc/chậm; bong bóng vẫn chặn một lần. Các hiệu ứng chậm không cộng dồn; hết chậm có 1 giây miễn nhiễm ngắn.

Biểu tượng trên vịt, danh sách skill và nhật ký sự kiện cho biết ai dùng skill, ai bị tác động và rune vừa xuất hiện. Nhật ký đang đua chỉ hiện sự kiện đã xảy ra. Kết quả các vòng mới có phần xem lại thiên phú, skill và diễn biến.

## Đua và điểm ngày

Đủ người chọn mới được xuất phát. Đếm ngược 3 giây không tính vào thời gian đua. Có tạm dừng, tiếp tục, âm thanh tùy chọn và toàn màn hình. Phím Space bắt đầu/tạm dừng khi không nhập liệu hoặc dùng nút khác.

Trong **5 giây cuối**, một số vịt được tăng tốc ngẫu nhiên. Cú tăng tốc bổ sung quãng đường thật nên vịt đang cuối vẫn có thể vượt lên thắng. Hiệu ứng vệt nước cho biết vịt nào đang bứt phá.

Với N người, vịt về hạng r mang lại **N − r + 1 điểm** cho người đã chọn. Sau mỗi vòng có bảng kết quả, tổng điểm ngày và thứ tự chọn vòng sau. Mọi người chọn lại vịt ở mỗi vòng.

## Khoản đóng quỹ cuối ngày

Hết số vòng của ngày:

- Người có tổng điểm **thấp nhất** phải đóng **60.000đ**.
- Người có tổng điểm **thấp thứ hai** phải đóng **40.000đ**.
- Những người còn lại không có khoản phải đóng cho ngày đó.

Nếu đồng điểm ảnh hưởng vị trí chót hoặc kế chót, nhóm liên quan đua phụ. **Hai người cùng thấp điểm nhất cũng phải phân định**, vì cần xác định rõ ai đóng 60k và ai đóng 40k. Người về cuối trong nhóm phân định nhận vị trí thấp hơn; đua phụ không cộng hoặc đổi điểm các vòng thường.

Chỉ khi ngày đã hoàn tất và phân định xong mới ghi **100.000đ phải đóng** vào quỹ mùa. Ngày chưa xong hoặc còn đua phụ chưa ghi khoản nào, kể cả đã biết chắc một người đóng 60k. Tổng quỹ được tính từ kết quả ngày đã lưu, nên F5, mở lại kết quả hoặc xem lại ngày cũ không cộng trùng.

## Quỹ mùa, thu tiền và chốt mùa

**Quỹ mùa giải** hiển thị theo từng người: số ngày hoàn tất, số lần chót/kế chót, tổng phải đóng, đã thu thực tế và còn thiếu. Có danh sách khoản theo từng ngày để đánh dấu **Đã thu** hoặc bỏ dấu nếu cần sửa. Kết quả đua không tự đánh dấu tiền đã được thu; ứng dụng không thực hiện chuyển tiền.

**Chốt mùa** mở bảng tổng kết để kiểm tra trước khi xác nhận. Chỉ chốt khi có ít nhất một ngày hoàn tất và không còn ngày chưa xong. Sau khi chốt, mùa cũ giữ nguyên lịch sử và kết quả, không thêm ngày đua; vẫn có thể cập nhật khoản thực thu còn thiếu. Sau đó mở mùa mới với điểm và quỹ mới bằng 0. Có thể hủy màn hình tạo mùa mới và tạo lại sau.

**Lịch sử** mở lại từng ngày và quỹ các mùa trước. Có CSV cho bảng điểm/chi tiết từng vòng của ngày và CSV cho quỹ mùa cùng từng khoản đóng.

## Lưu và khôi phục

Mùa, ngày, lựa chọn, kết quả và trạng thái thu tiền được lưu bằng **localStorage trên trình duyệt này**, không đồng bộ qua thiết bị hay tài khoản.

- F5 lúc chọn vịt giữ nguyên những lựa chọn hợp lệ và đúng lượt chọn tiếp theo.
- F5 giữa cuộc đua khôi phục cùng vịt, cùng seed mô phỏng và thời gian đã lưu ở trạng thái **tạm dừng**. Bấm **Tiếp tục** để chơi tiếp. Trang lưu định kỳ khoảng 0,5 giây khi đang chạy; thời điểm khôi phục có thể lùi nhẹ so với hình cuối vừa thấy.
- Các vòng mới lưu cả phiên bản mô phỏng; F5 giữ nguyên skill, rune, mục tiêu bom, swap và các lần kháng. Vòng đã xong lưu seed để dựng lại nhật ký, không tính điểm lần nữa.
- Kết quả được ghi đúng một lần cho mỗi mã vòng. Giải mới/ngày mới không xóa lịch sử.
- Nếu trình duyệt không cho lưu hoặc hết dung lượng, game hiện thông báo: giữ trang mở và tải CSV. Nếu dữ liệu lưu không hợp lệ, bản cũ được giữ nguyên và phiên hiện tại không ghi đè.
- Xóa dữ liệu trang web sẽ làm mất lịch sử trên thiết bị đó. Phiên ẩn danh không giữ dữ liệu sau khi đóng toàn bộ cửa sổ của phiên.

### Dữ liệu từ bản trước

Ứng dụng mới dùng khóa `vit-dua-seasons-v3`. Khi chưa có dữ liệu mới, nó đọc dữ liệu bản trước từ `vit-dua-club-v2`, kiểm tra và đưa các giải cũ vào mục **Trước mùa giải**. Khóa gốc bản trước **không bị sửa hoặc xóa**.

Các giải cũ giữ nguyên điểm, kết quả, lựa chọn và cuộc đua đang dở; tiếp tục dùng luật cà phê cũ. Chúng không thuộc quỹ mùa mới và **không bị tính tiền hồi tố**. Quy tắc ưu tiên mới kiểm tra chặt thứ tự lựa chọn của các ngày theo luật mùa mới; lựa chọn dở hợp lệ từ bản cũ vẫn được bảo toàn khi chuyển dữ liệu.

Một cuộc đua mùa giải đã xuất phát trước bản thiên phú vẫn dùng mô phỏng cũ đến hết vòng đó. Vòng tiếp theo mới dùng `chaos-v1`. Các giải cà phê phiên bản 2 tiếp tục dùng mô phỏng cũ trong mọi vòng. Dữ liệu có phiên bản cuộc đua đang dở chưa hỗ trợ sẽ không được tự chạy lại bằng một cơ chế khác hoặc ghi đè.

## Cơ chế mô phỏng

Mỗi vòng có seed ngẫu nhiên từ Web Crypto. `chaos-v1` tích phân quãng đường theo bước 1/20 giây, gồm vận tốc cơ bản, thiên phú, skill, rune, tác động chậm và nước rút sin² trong 5 giây cuối. Swap thực sự hoán đổi quãng đường của hai vịt tại thời điểm sự kiện. Thứ hạng lấy từ quãng đường cuối, không phải bảng kết quả gán sẵn. Quãng đường được chuẩn hóa để vịt thắng chạm đích ở đúng thời lượng đã chọn.

Tên người chơi và tổng điểm ngày không thay đổi xác suất sự kiện. Thiên phú có ảnh hưởng được công bố trên từng vịt. Các dòng ngẫu nhiên dành cho chuyển động, skill, rune và kháng được tách riêng; cùng seed và phiên bản luôn dựng lại cùng diễn biến. Không được chỉnh các quy tắc `chaos-v1` đã phát hành tại chỗ nếu làm đổi kết quả lưu; thay đổi tương lai cần phiên bản mô phỏng mới và giữ bộ đọc cũ.

## Đồ họa và chuyển động

- Bộ vịt dùng chung một ảnh sprite trong `dist/assets/duck-atlas.png`; tên, số vịt, màu nhận diện và thiên phú giữ nguyên. Cảnh sông có nền `river-garden.png`, vùng xuất phát, đích và thứ hạng trực tiếp cạnh từng vịt.
- Khi đua, đường đua mở rộng; thân vịt nổi nhẹ trên nước, nhãn tên và hạng tách khỏi chuyển động của thân để dễ đọc. Vị trí theo `requestAnimationFrame` và nội suy sẵn có của engine, không thêm độ trễ vào quãng đường hay đổi kết quả.
- Lớp `race-visuals.js` chỉ vẽ hiệu ứng: gợn nước, vệt tăng tốc, bom bay, cổng swap, nhặt rune, khiên và pháo giấy cuối lượt. Canvas giới hạn theo vùng nhìn thấy; tạm dừng không tiếp tục chạy hiệu ứng. Khôi phục trận không phát lại các hiệu ứng ngắn đã qua.
- Trình duyệt bật giảm chuyển động sẽ bỏ các hoạt ảnh trang trí; không hỗ trợ Canvas 2D vẫn đua và tính điểm bình thường.
- Cập nhật DOM chỉ khi nhãn/hạng/trạng thái đổi; checkpoint định kỳ vẫn khoảng 0,5 giây nhưng tái sử dụng phần lịch sử đã mã hóa thay vì mã hóa lại toàn bộ mùa mỗi lần. Khóa và định dạng localStorage giữ nguyên; đổi vòng hoặc thay đổi dữ liệu sẽ hủy bộ nhớ đệm checkpoint.

## Kiểm tra và đóng góp

Từ thư mục gốc, chạy các bài kiểm tra mô phỏng, tính điểm và quản lý mùa với Node.js 22 trở lên.

```sh
node --test "tests/*.test.cjs"
```

Để chạy thêm các bài kiểm tra giao diện, vào thư mục `qa`.

```sh
cd qa
npm ci
npm test
```

Bạn có thể mở [issue](https://github.com/hoangbaophu89/vit-dua/issues) để báo lỗi, hoặc gửi pull request kèm cách tái hiện và kết quả kiểm tra. Nếu thay đổi cách tính cuộc đua, hãy giữ khả năng khôi phục các vòng đang chạy từ phiên bản trước.

## Giấy phép

Dự án sử dụng [giấy phép MIT](LICENSE). Hai ảnh trong `dist/assets/` được tạo bằng ImageGen cho Vịt Đua.
