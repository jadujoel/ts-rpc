import React from "react";
import ReactDOM from "react-dom/client";
import { ChatApp } from "./App.tsx";
import "./style.css";

const root = document.getElementById("root");
if (root) {
	ReactDOM.createRoot(root).render(
		<React.StrictMode>
			<ChatApp />
		</React.StrictMode>,
	);
}
