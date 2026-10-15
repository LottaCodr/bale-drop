import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";

export default function App() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text>Bale Drop Mobile</Text>
      <StatusBar style="auto" />
    </View>
  );
}
