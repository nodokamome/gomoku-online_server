//環境変数
require('dotenv').config()
const { DB } = process.env          //DB名
const { DBHOST } = process.env      //DBのホスト名
const { DBUSER } = process.env      //
const { DBPASSWORD } = process.env
const { PORT } = process.env

//MySQLと接続
var mysql = require('mysql');
var mysqlConnection = mysql.createConnection({
	host: DBHOST,
	user: DBUSER,
	database: DB,
	password: DBPASSWORD
});
mysqlConnection.connect();

//connection、Wait_RoomとGame_Roomの初期化(No.0~99の部屋作成)
var connections = [];
var Wait_Room = [];
var Game_Room = [];
Initialization();

//WebSocket宣言
var ws = require('ws').Server
var wss = new ws({ port: PORT });
console.log(TimeStamp() + "StartServer Port:" + PORT);

//オンライン数のカウントとDB更新
var CountOnline = 0;
UpdateOnlineCount(CountOnline);

wss.on('connection', function (ws) {
	//新規接続時、配列にWebSocket接続を保存
	connections.push(ws);
	console.log(TimeStamp() + "新規サーバー接続しました。");
	var connectionID = connections.length - 1;
	SendMessage("Connection", connectionID);
	CountOnline++;
	UpdateOnlineCount(CountOnline);
	//切断時
	ws.on('close', function () {
		console.log(TimeStamp() + "退出しました");
		connections = connections.filter(function (con, connectionID) {
			if (con == ws) {
				//待機中に退出したとき
				Wait_Room.forEach(function (room, roomID) {
					if (connectionID == room.connectionID) {
						Wait_Room[roomID] = 0;
						console.log(TimeStamp() + "Wait_Room[" + roomID + "] から userID:" + room.userID + " が退出しました。");
						console.log(TimeStamp() + "Wait_Room:" + JSON.stringify(Wait_Room));
					}
				});
			}
		});
		CountOnline--;
		UpdateOnlineCount(CountOnline);
	});

	//メッセージ受信時
	ws.on('message', function (message) {
		obj = JSON.parse(message);

		if (obj.isWait) {
			//待ちの人は待合室に追加する
			var waitUser = {
				"userID": obj.userID,
				"connectionID": connectionID,
				"passBattle": obj.passBattle,
			};
			for (var i = 0; i < Wait_Room.length; i++) {
				if (Wait_Room[i] == 0) {
					Wait_Room[i] = waitUser;
					console.log(TimeStamp() + "Wait_Room[" + i + "] に userID:" + waitUser.userID + " が入室しました。");
					console.log(TimeStamp() + "Wait_Room:" + JSON.stringify(Wait_Room));
					SendMessage("Waiting", connectionID);
					break;
				}
			}

			//待合室で同じパスワード待ち&&自分以外&&UserIDが空白でない人（エラー処理）がいたときにマッチTrue
			var isMatch = false;
			for (var i = 0; i < Wait_Room.length; i++) {
				if (Wait_Room[i].passBattle == obj.passBattle && Wait_Room[i].userID != obj.userID && Wait_Room[i].userID != "") {
					isMatch = true;
					console.log(TimeStamp() + "対戦相手が見つかりました。");
					break;
				}
			}
			if (isMatch) {
				//Game_Roomに代入するroomData
				var roomData = {
					"BlackPlayer": Wait_Room[i].userID,
					"BlackPlayerConnectionID": Wait_Room[i].connectionID,
					"WhitePlayer": obj.userID,
					"WhitePlayerConnectionID": connectionID,
					"isGame": true,
					"result": "",
					"newPosX": "",
					"newPosZ": "",
					"previousPlayer": "",
					"currentPlayer": "White",
				};
				//空いているGame_Roomに追加
				for (var i = 0; i < Game_Room.length; i++) {
					if (Game_Room[i] == 0) {
						Game_Room[i] = roomData;
						console.log(TimeStamp() + "Game_Room[" + i + "] に userID:" + roomData.BlackPlayer + " が入室しました。");
						console.log(TimeStamp() + "Game_Room[" + i + "] に userID:" + roomData.WhitePlayer + " が入室しました。");
						console.log(TimeStamp() + "Game_Room:" + JSON.stringify(roomData));
						//代入したユーザを待合室から退出させる
						for (var j = 0; j < Wait_Room.length; j++) {
							if (Wait_Room[j].userID == roomData.BlackPlayer) {
								Wait_Room[j] = 0;
							}
							if (Wait_Room[j].userID == roomData.WhitePlayer) {
								Wait_Room[j] = 0;
							}
						}
						break;
					}
				}

				//開始のブロードキャスト
				var array = {
					"roomID": (i).toString(),
					"BlackPlayer_userID": roomData.BlackPlayer,
					"WhitePlayer_userID": roomData.WhitePlayer,
					"isGame": true,
					"result": "",
					"newPosX": "",
					"newPosZ": "",
					"previousPlayer": "",
					"currentPlayer": "White",
				};
				var SendData = JSON.stringify(array);
				broadcast(SendData, i);
			}
		} else {
			if (obj.newPosX != null && obj.newPosZ != null) {
				if (obj.result != "") {
					var currentPlayer = obj.currentPlayer;
				} else if (obj.result == "") {
					if (obj.currentPlayer == "White") {
						var currentPlayer = "Black";
					} else if (obj.currentPlayer == "Black") {
						var currentPlayer = "White";
					}
				}

				var array = {
					"roomID": obj.roomID,
					"BlackPlayer_userID": Game_Room[obj.roomID].BlackPlayer,
					"WhitePlayer_userID": Game_Room[obj.roomID].WhitePlayer,
					"isGame": true,
					"result": obj.result,
					"newPosX": obj.newPosX,
					"newPosZ": obj.newPosZ,
					"status": obj.status,
					"previousPlayer": obj.currentPlayer,
					"currentPlayer": currentPlayer,
				};
				var SendData = JSON.stringify(array);
				broadcast(SendData, obj.roomID);
				if (obj.result != "" && Game_Room[obj.roomID] != 0) {
					if (obj.result == Game_Room[obj.roomID].WhitePlayer) {
						//白の勝ち
						UpdateResult(1, 0, Game_Room[obj.roomID].WhitePlayer);
						UpdateResult(0, 1, Game_Room[obj.roomID].BlackPlayer);

					} else if (obj.result == Game_Room[obj.roomID].BlackPlayer) {
						//黒の勝ち
						UpdateResult(0, 1, Game_Room[obj.roomID].WhitePlayer);
						UpdateResult(1, 0, Game_Room[obj.roomID].BlackPlayer);
					}
					console.log(TimeStamp() + "Game_Room[" + obj.roomID + "] が開放されました。");
				}
			}
		}
	});
});

//ブロードキャスト
function broadcast(message, roomID) {
	connections.forEach(function (con, connectionID) {
		if (connectionID == Game_Room[roomID].BlackPlayerConnectionID) {
			//console.log(TimeStamp() + "Send To BlackPlayer Game_Room[" + roomID + "]");
			con.send(message);
		}
		if (connectionID == Game_Room[roomID].WhitePlayerConnectionID) {
			//console.log(TimeStamp() + "Send To WhitePlayer Game_Room[" + roomID + "]");
			con.send(message);
		}
		console.log(TimeStamp() + "Broadcast Game_Room[" + roomID + "]" + message);
	});
};

//データ送信
function SendMessage(message, tmpConnectionID) {
	connections.forEach(function (con, connectionID) {
		if (connectionID == tmpConnectionID) {
			console.log(TimeStamp() + "メッセージ送信:[" + message + "] to connectionID " + connectionID);
			con.send(message);
		}
	});
}

//ランダム
/*
function getRoomID() {
	//使用文字の定義
	var str = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&=~/*-+";

	//桁数の定義
	var len = 8;

	//ランダムな文字列の生成
	var result = "";
	for (var i = 0; i < len; i++) {
		result += str.charAt(Math.floor(Math.random() * str.length));
	}
	return result;
}
*/

//タイムスタンプ
function TimeStamp() {
	const date1 = new Date();
	const date2 = ("[" + date1.getFullYear() + "-" +
		(date1.getMonth() + 1) + "-" +
		date1.getDate() + " " +
		date1.getHours() + "時" +
		date1.getMinutes() + "分" +
		date1.getSeconds() + "秒" +
		date1.getMilliseconds() + "] ")
	return date2;
}

//オンラインカウント
function UpdateOnlineCount(CountOnline) {
	mysqlConnection.query(
		'UPDATE online SET count = ' + CountOnline + ';'
		, function (err, rows, fields) {
			if (err) {
				console.log("UPDATE Error online :" + err.toString());
			}
			console.log(TimeStamp() + "オンライン人数 " + CountOnline + " 人");
		});
}
//勝負結果更新
function UpdateResult(record_win, record_lose, userID) {
	mysqlConnection.query(
		'UPDATE user_list SET record_win = record_win +' + record_win + ', record_lose = record_lose + ' + record_lose + '  WHERE userID = "' + userID.toString() + '";'
		, function (err, rows, fields) {
			if (err) {
				console.log("UPDATE Error online :" + err.toString());
			}
			if (record_win == 1) {
				console.log(TimeStamp() + "UpdateResult " + "userID:" + userID + " 【win】");
			}
			if (record_lose == 1) {
				console.log(TimeStamp() + "UpdateResult " + "userID:" + userID + " 【lose】");
			}
		});
}

//待合室、ゲーム室の初期化
function Initialization() {
	for (var i = 0; i < 100; i++) {
		Wait_Room[i] = 0;
		Game_Room[i] = 0;
	}
}
