import Capacitor
final class ZhixuViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(ZhixuLocalPlugin()) }
}
