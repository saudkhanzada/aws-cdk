import * as ec2 from '@aws-cdk/aws-ec2';
import * as cloudmap from '@aws-cdk/aws-servicediscovery';
import * as cdk from '@aws-cdk/core';
import * as appmesh from '../lib/';

export const app = new cdk.App();

const stack = new cdk.Stack(app, 'mesh-stack', {});

const vpc = new ec2.Vpc(stack, 'vpc', {
  natGateways: 1,
});

const namespace = new cloudmap.PrivateDnsNamespace(stack, 'test-namespace', {
  vpc,
  name: 'domain.local',
});

const mesh = new appmesh.Mesh(stack, 'mesh');
const router = mesh.addVirtualRouter('router', {
  listeners: [
    appmesh.VirtualRouterListener.http(),
  ],
});

const virtualService = new appmesh.VirtualService(stack, 'service', {
  virtualServiceProvider: appmesh.VirtualServiceProvider.virtualRouter(router),
  virtualServiceName: 'service1.domain.local',
});

const node = mesh.addVirtualNode('node', {
  serviceDiscovery: appmesh.ServiceDiscovery.dns(`node1.${namespace.namespaceName}`),
  listeners: [appmesh.VirtualNodeListener.http({
    healthCheck: appmesh.HealthCheck.http({
      healthyThreshold: 3,
      path: '/check-path',
    }),
  })],
  backends: [appmesh.Backend.virtualService(virtualService)],
});

node.addBackend(appmesh.Backend.virtualService(
  new appmesh.VirtualService(stack, 'service-2', {
    virtualServiceName: 'service2.domain.local',
    virtualServiceProvider: appmesh.VirtualServiceProvider.none(mesh),
  }),
));

router.addRoute('route-1', {
  routeSpec: appmesh.RouteSpec.http({
    weightedTargets: [
      {
        virtualNode: node,
        weight: 50,
      },
    ],
    match: {
      prefixPath: '/',
    },
    timeout: {
      idle: cdk.Duration.seconds(10),
      perRequest: cdk.Duration.seconds(10),
    },
  }),
});

const node2 = mesh.addVirtualNode('node2', {
  serviceDiscovery: appmesh.ServiceDiscovery.dns(`node2.${namespace.namespaceName}`),
  listeners: [appmesh.VirtualNodeListener.http({
    healthCheck: appmesh.HealthCheck.http({
      healthyThreshold: 3,
      interval: cdk.Duration.seconds(5),
      path: '/check-path2',
      timeout: cdk.Duration.seconds(2),
      unhealthyThreshold: 2,
    }),
  })],
  backendDefaults: {
    tlsClientPolicy: {
      validation: {
        trust: appmesh.TlsValidationTrust.file('path/to/cert'),
      },
    },
  },
  backends: [appmesh.Backend.virtualService(
    new appmesh.VirtualService(stack, 'service-3', {
      virtualServiceName: 'service3.domain.local',
      virtualServiceProvider: appmesh.VirtualServiceProvider.none(mesh),
    }),
  )],
});

const node3 = mesh.addVirtualNode('node3', {
  serviceDiscovery: appmesh.ServiceDiscovery.dns(`node3.${namespace.namespaceName}`),
  listeners: [appmesh.VirtualNodeListener.http({
    healthCheck: appmesh.HealthCheck.http({
      healthyThreshold: 3,
      interval: cdk.Duration.seconds(5),
      path: '/check-path3',
      timeout: cdk.Duration.seconds(2),
      unhealthyThreshold: 2,
    }),
  })],
  backendDefaults: {
    tlsClientPolicy: {
      validation: {
        trust: appmesh.TlsValidationTrust.file('path-to-certificate'),
      },
    },
  },
  accessLog: appmesh.AccessLog.fromFilePath('/dev/stdout'),
});

const node4 = mesh.addVirtualNode('node4', {
  serviceDiscovery: appmesh.ServiceDiscovery.dns(`node4.${namespace.namespaceName}`, appmesh.DnsResponseType.ENDPOINTS),
  listeners: [appmesh.VirtualNodeListener.http({
    tls: {
      mode: appmesh.TlsMode.STRICT,
      certificate: appmesh.TlsCertificate.sds('spiffe://domain.local/backend-service'),
      mutualTlsValidation: {
        trust: appmesh.TlsValidationTrust.sds('spiffe://domain.local'),
        subjectAlternativeNames: appmesh.SubjectAlternativeNames.matchingExactly('client.domain.local'),
      },
    },
    healthCheck: appmesh.HealthCheck.http({
      healthyThreshold: 3,
      interval: cdk.Duration.seconds(5),
      path: '/check-path3',
      timeout: cdk.Duration.seconds(2),
      unhealthyThreshold: 2,
    }),
  })],
  backendDefaults: {
    tlsClientPolicy: {
      mutualTlsCertificate: appmesh.TlsCertificate.file('path/to/certChain', 'path/to/privateKey'),
      validation: {
        subjectAlternativeNames: appmesh.SubjectAlternativeNames.matchingExactly('mymesh.local'),
        trust: appmesh.TlsValidationTrust.file('path-to-certificate'),
      },
    },
  },
  accessLog: appmesh.AccessLog.fromFilePath('/dev/stdout'),
});

node4.addBackend(appmesh.Backend.virtualService(
  new appmesh.VirtualService(stack, 'service-4', {
    virtualServiceName: 'service4.domain.local',
    virtualServiceProvider: appmesh.VirtualServiceProvider.none(mesh),
  }),
));

router.addRoute('route-2', {
  routeSpec: appmesh.RouteSpec.http({
    weightedTargets: [
      {
        virtualNode: node2,
        weight: 30,
      },
    ],
    match: {
      prefixPath: '/path2',
    },
    timeout: {
      idle: cdk.Duration.seconds(11),
      perRequest: cdk.Duration.seconds(11),
    },
  }),
});

router.addRoute('route-3', {
  routeSpec: appmesh.RouteSpec.tcp({
    weightedTargets: [
      {
        virtualNode: node3,
        weight: 20,
      },
    ],
    timeout: {
      idle: cdk.Duration.seconds(12),
    },
  }),
});

router.addRoute('route-4', {
  routeSpec: appmesh.RouteSpec.grpc({
    weightedTargets: [
      {
        virtualNode: node4,
        weight: 20,
      },
    ],
    timeout: {
      idle: cdk.Duration.seconds(12),
    },
    match: {
      serviceName: 'test',
    },
  }),
});

router.addRoute('route-matching', {
  routeSpec: appmesh.RouteSpec.http2({
    weightedTargets: [{ virtualNode: node3 }],
    match: {
      prefixPath: '/',
      method: appmesh.HttpRouteMatchMethod.POST,
      protocol: appmesh.HttpRouteProtocol.HTTPS,
      headers: [
        appmesh.HttpHeaderMatch.valueIs('Content-Type', 'application/json'),
        appmesh.HttpHeaderMatch.valueStartsWith('Content-Type', 'application/json'),
        appmesh.HttpHeaderMatch.valueEndsWith('Content-Type', 'application/json'),
        appmesh.HttpHeaderMatch.valueMatchesRegex('Content-Type', 'application/.*'),
        appmesh.HttpHeaderMatch.valuesIsInRange('Content-Type', 1, 5),
        appmesh.HttpHeaderMatch.valueIsNot('Content-Type', 'application/json'),
        appmesh.HttpHeaderMatch.valueDoesNotStartWith('Content-Type', 'application/json'),
        appmesh.HttpHeaderMatch.valueDoesNotEndWith('Content-Type', 'application/json'),
        appmesh.HttpHeaderMatch.valueDoesNotMatchRegex('Content-Type', 'application/.*'),
        appmesh.HttpHeaderMatch.valuesIsNotInRange('Content-Type', 1, 5),
      ],
    },
  }),
});

router.addRoute('route-http2-retry', {
  routeSpec: appmesh.RouteSpec.http2({
    weightedTargets: [{ virtualNode: node3 }],
    retryPolicy: {
      httpRetryEvents: [appmesh.HttpRetryEvent.CLIENT_ERROR],
      tcpRetryEvents: [appmesh.TcpRetryEvent.CONNECTION_ERROR],
      retryAttempts: 5,
      retryTimeout: cdk.Duration.seconds(1),
    },
  }),
});

router.addRoute('route-5', {
  routeSpec: appmesh.RouteSpec.http2({
    priority: 10,
    weightedTargets: [{ virtualNode: node2 }],
  }),
});

router.addRoute('route-grpc-retry', {
  routeSpec: appmesh.RouteSpec.grpc({
    weightedTargets: [{ virtualNode: node3 }],
    match: { serviceName: 'servicename' },
    retryPolicy: {
      grpcRetryEvents: [appmesh.GrpcRetryEvent.DEADLINE_EXCEEDED],
      httpRetryEvents: [appmesh.HttpRetryEvent.CLIENT_ERROR],
      tcpRetryEvents: [appmesh.TcpRetryEvent.CONNECTION_ERROR],
      retryAttempts: 5,
      retryTimeout: cdk.Duration.seconds(1),
    },
  }),
});

const gateway = mesh.addVirtualGateway('gateway1', {
  accessLog: appmesh.AccessLog.fromFilePath('/dev/stdout'),
  virtualGatewayName: 'gateway1',
});

new appmesh.VirtualGateway(stack, 'gateway2', {
  mesh: mesh,
  listeners: [appmesh.VirtualGatewayListener.http({
    port: 443,
    healthCheck: appmesh.HealthCheck.http({
      interval: cdk.Duration.seconds(10),
    }),
    tls: {
      mode: appmesh.TlsMode.STRICT,
      certificate: appmesh.TlsCertificate.file('path/to/certChain', 'path/to/privateKey'),
    },
  })],
});

new appmesh.VirtualGateway(stack, 'gateway3', {
  mesh: mesh,
  listeners: [appmesh.VirtualGatewayListener.http({
    port: 443,
    healthCheck: appmesh.HealthCheck.http({
      interval: cdk.Duration.seconds(10),
    }),
    tls: {
      mode: appmesh.TlsMode.STRICT,
      certificate: appmesh.TlsCertificate.sds('secret_certificate'),
      mutualTlsValidation: {
        trust: appmesh.TlsValidationTrust.file('path/to/certChain'),
      },
    },
  })],
  backendDefaults: {
    tlsClientPolicy: {
      mutualTlsCertificate: appmesh.TlsCertificate.sds('secret_validation'),
      validation: {
        trust: appmesh.TlsValidationTrust.file('path/to/certChain'),
      },
    },
  },
});

gateway.addGatewayRoute('gateway1-route-http', {
  routeSpec: appmesh.GatewayRouteSpec.http({
    routeTarget: virtualService,
  }),
});

gateway.addGatewayRoute('gateway1-route-http2', {
  routeSpec: appmesh.GatewayRouteSpec.http2({
    routeTarget: virtualService,
  }),
});

gateway.addGatewayRoute('gateway1-route-grpc', {
  routeSpec: appmesh.GatewayRouteSpec.grpc({
    routeTarget: virtualService,
    match: {
      serviceName: virtualService.virtualServiceName,
    },
  }),
});
